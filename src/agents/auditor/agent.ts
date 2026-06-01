import fs from "node:fs";
import path from "node:path";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, type GraphNode, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import { logger } from "../../logger.ts";
import { createLLM } from "../../config/llm.ts";
import { emitStep } from "../../logger.ts";
import { JUDGE_FINDINGS_PROMPT, FIND_VULNERABILITIES_PROMPT, GATHER_CONTEXT_PROMPT } from "./prompts.ts";
import { AuditorState, JudgeReviewSchema, CandidateFindingSchema } from "./state.ts";
import { analyzeSolidityFile } from "./tools/solidity-analyzer-tool.ts";
import { buildRepoTree } from "./tools/repo-tree-tool.ts";
import {
  DOC_BASENAMES,
  DOC_EXTS,
  MAX_DEPTH,
  MAX_DOC_CHARS,
  MAX_REFLECTIONS,
  MAX_SOL_CHARS,
  SKIP_DIRS,
  SOL_EXT,
  SOL_TEST_SUFFIXES,
} from "./config.ts";
import { matchLines } from "./utils.ts";

const llm = createLLM();

const walkDirectory = (dir: string, depth: number, solFiles: string[], docFiles: string[]) => {
  if (depth > MAX_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walkDirectory(path.join(dir, entry.name), depth + 1, solFiles, docFiles);
      }
    } else if (entry.isFile()) {
      const fullPath = path.join(dir, entry.name);
      const ext = path.extname(entry.name).toLowerCase();
      const base = path.basename(entry.name, ext).toLowerCase();

      if (ext === SOL_EXT) {
        const isTest = SOL_TEST_SUFFIXES.some((suffix) => entry.name.endsWith(suffix));
        if (!isTest) solFiles.push(fullPath);
      } else if (DOC_EXTS.has(ext) || DOC_BASENAMES.has(base)) {
        docFiles.push(fullPath);
      }
    }
  }
};

const defineScope: GraphNode<typeof AuditorState> = async (state) => {
  emitStep({ agent: "auditor", step: "scope", status: "running" });
  logger.info(`[Auditor] defineScope: percorrendo repositório em ${state.repoPath}`);

  const solFiles: string[] = [];
  const docFiles: string[] = [];

  walkDirectory(state.repoPath, 0, solFiles, docFiles);

  const fileTree = buildRepoTree(state.repoPath);

  logger.info(`[Auditor] defineScope: encontrado(s) ${solFiles.length} arquivo(s) Solidity e ${docFiles.length} arquivo(s) de documentação`);
  logger.debug(`[Auditor] defineScope: arquivos Solidity: ${JSON.stringify(solFiles)}`);
  logger.debug(`[Auditor] defineScope: arquivos de documentação: ${JSON.stringify(docFiles)}`);
  logger.debug(`[Auditor] defineScope: árvore de arquivos:\n${fileTree}`);

  emitStep({ agent: "auditor", step: "scope", status: "done" });
  return { scope: solFiles, docs: docFiles, fileTree };
};

const gatherContext: GraphNode<typeof AuditorState> = async (state) => {
  emitStep({ agent: "auditor", step: "ctx", status: "running" });
  logger.info(`[Auditor] gatherContext: processando ${state.scope.length} arquivo(s) Solidity e ${state.docs.length} arquivo(s) de documentação`);

  const readFile = (filePath: string): string => {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  };

  // Read and analyze each Solidity file
  const solidityEntries: { filePath: string; source: string; analysis: string }[] = [];
  for (const filePath of state.scope) {
    const source = readFile(filePath).slice(0, MAX_SOL_CHARS);
    if (!source) continue;
    const analysis = await analyzeSolidityFile(source, "full");
    solidityEntries.push({ filePath, source, analysis });
  }

  // Read documentation files
  const docEntries: { filePath: string; content: string }[] = [];
  for (const filePath of state.docs) {
    const content = readFile(filePath).slice(0, MAX_DOC_CHARS);
    if (content) docEntries.push({ filePath, content });
  }

  // Build the LLM input
  const parts: string[] = [];

  if (docEntries.length > 0) {
    parts.push("## Documentation\n");
    for (const { filePath, content } of docEntries) {
      parts.push(`### ${filePath}\n${content}`);
    }
  }

  parts.push("## Structural Analysis (auto-generated)\n");
  for (const { filePath, analysis } of solidityEntries) {
    parts.push(`### ${filePath}\n${analysis}`);
  }

  parts.push("## Contract Source Code\n");
  for (const { filePath, source } of solidityEntries) {
    parts.push(`### ${filePath}\n\`\`\`solidity\n${source}\n\`\`\``);
  }

  const model = llm.withStructuredOutput(z.object({ context: z.string() }));
  const result = await model.invoke([new SystemMessage(GATHER_CONTEXT_PROMPT), new HumanMessage(parts.join("\n\n"))]);

  logger.info(`[Auditor] gatherContext: contexto construído (${parts.join("\n\n").length} caracteres)`);
  logger.debug(`[Auditor] gatherContext: contexto completo:\n${parts.join("\n\n")}`);

  emitStep({ agent: "auditor", step: "ctx", status: "done" });
  return { repoContext: result.context };
};

const findVulnerabilities: GraphNode<typeof AuditorState> = async (state) => {
  const model = llm.withStructuredOutput(z.object({ findings: z.array(CandidateFindingSchema) }));

  const previousFeedback =
    state.judgeReviews.length > 0
      ? state.judgeReviews
          .map((r, i) => {
            const title = state.candidateFindings[i]?.title ?? `Finding ${i + 1}`;
            return `- "${title}": ${r.isFalsePositive ? "FALSE POSITIVE" : "TRUE POSITIVE"}\n  Judge: ${r.review}`;
          })
          .join("\n")
      : null;

  logger.info(
    `[Auditor] findVulnerabilities: invocando LLM para ${state.scope.length} arquivo(s) em paralelo (iteração ${state.reflectionCount + 1})`,
  );
  emitStep({ agent: "auditor", step: "find", status: "running", detail: `iter ${state.reflectionCount + 1}` });

  const allFindings = await Promise.all(
    state.scope.map(async (filePath) => {
      let source: string;
      try {
        source = fs.readFileSync(filePath, "utf-8").slice(0, MAX_SOL_CHARS);
      } catch {
        return [];
      }
      if (!source) return [];

      let userMessage = `Contract (${filePath}):\n\n${source}\n\nProtocol Context:\n${state.repoContext}`;
      if (previousFeedback) {
        userMessage += `\n\nJudge feedback from previous iteration (iteration ${state.reflectionCount}):\n${previousFeedback}\n\nRevise your findings accordingly.`;
      }

      logger.debug(`[Auditor] findVulnerabilities: processando ${filePath}`);

      const result = await model.invoke([
        new SystemMessage(FIND_VULNERABILITIES_PROMPT),
        new HumanMessage(userMessage),
      ]);

      return result.findings.map((finding: any) => ({
        ...finding,
        path: filePath,
        location: matchLines(source, finding.codeSnippet) ?? "",
      }));
    }),
  );

  const candidateFindings = allFindings.flat();
  logger.info(`[Auditor] findVulnerabilities: LLM retornou ${candidateFindings.length} finding(s) candidato(s) no total`);
  logger.debug(`[Auditor] findVulnerabilities: findings:\n${JSON.stringify(candidateFindings, null, 2)}`);

  emitStep({ agent: "auditor", step: "find", status: "done" });
  return { candidateFindings };
};

const judgeFindings: GraphNode<typeof AuditorState> = async (state) => {
  emitStep({ agent: "auditor", step: "judge", status: "running" });
  if (state.candidateFindings.length === 0) {
    logger.info("[Auditor] judgeFindings: sem findings candidatos para revisar, pulando chamada ao LLM");
    emitStep({ agent: "auditor", step: "judge", status: "done" });
    return {
      judgeReviews: [],
      findings: [],
      reflectionCount: state.reflectionCount + 1,
    };
  }

  const model = llm.withStructuredOutput(JudgeReviewSchema);

  logger.info(`[Auditor] judgeFindings: revisando ${state.candidateFindings.length} finding(s) candidato(s) em paralelo`);

  const reviews = await Promise.all(
    state.candidateFindings.map(async (finding, i) => {
      let source: string;
      try {
        source = fs.readFileSync(finding.path, "utf-8").slice(0, MAX_SOL_CHARS);
      } catch {
        source = "";
      }

      const findingText = `[Finding ${i + 1}] ${finding.title}\nSeverity: ${finding.severity}\nDescription: ${finding.description}\nLocation: ${finding.path} lines ${finding.location}\nCode:\n\`\`\`solidity\n${finding.codeSnippet}\n\`\`\``;

      logger.debug(`[Auditor] judgeFindings: revisando finding ${i + 1}: ${finding.title}`);
      return model.invoke([
        new SystemMessage(JUDGE_FINDINGS_PROMPT),
        new HumanMessage(
          `Contract (${finding.path}):\n\n${source}\n\nProtocol Context:\n${state.repoContext}\n\nFinding to Review:\n\n${findingText}`,
        ),
      ]);
    }),
  );

  const confirmedEntries = state.candidateFindings
    .map((finding, i) => ({ finding, review: reviews[i] }))
    .filter(({ review }) => !review.isFalsePositive);

  const findings = confirmedEntries.map(({ finding, review }) => ({
    ...finding,
    judgeReview: {
      review: review.review,
      confidence: review.confidence,
      exploitablePaths: review.exploitablePaths,
    },
  }));

  const falsePositiveCount = state.candidateFindings.length - findings.length;

  logger.info(`[Auditor] judgeFindings: ${findings.length} confirmado(s), ${falsePositiveCount} falso(s) positivo(s)`);
  logger.debug(`[Auditor] judgeFindings: revisões:\n${JSON.stringify(reviews, null, 2)}`);

  emitStep({ agent: "auditor", step: "judge", status: "done" });
  return {
    judgeReviews: reviews,
    findings,
    reflectionCount: state.reflectionCount + 1,
  };
};

export const auditorAgent = new StateGraph(AuditorState)
  .addNode("defineScope", defineScope)
  .addNode("gatherContext", gatherContext)
  .addNode("findVulnerabilities", findVulnerabilities)
  .addNode("judgeFindings", judgeFindings)
  .addEdge(START, "defineScope")
  .addEdge("defineScope", "gatherContext")
  .addEdge("gatherContext", "findVulnerabilities")
  .addEdge("findVulnerabilities", "judgeFindings")
  .addConditionalEdges("judgeFindings", (state) => {
    const hasFalsePositives = state.judgeReviews.some((r) => r.isFalsePositive);
    if (hasFalsePositives && state.reflectionCount < MAX_REFLECTIONS) {
      return "findVulnerabilities";
    }
    return END;
  })
  .compile();

export const testAgent = new StateGraph(AuditorState)
  .addNode("defineScope", defineScope)
  .addNode("gatherContext", gatherContext)
  .addEdge(START, "defineScope")
  .addEdge("defineScope", "gatherContext")
  .addEdge("gatherContext", END)
  .compile();

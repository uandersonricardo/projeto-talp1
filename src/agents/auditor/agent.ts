import fs from "node:fs";
import path from "node:path";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, type GraphNode, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import { createLLM } from "../../config/llm.ts";
import { logger } from "../../logger.ts";
import {
  DOC_BASENAMES,
  DOC_EXTS,
  MAX_DEPTH,
  MAX_DOC_CHARS,
  MAX_REFLECTIONS,
  MAX_SOL_CHARS,
  MIN_FILE_IMPORTANCE,
  SKIP_DIRS,
  SOL_EXT,
  SOL_TEST_SUFFIXES,
} from "./config.ts";
import {
  FIND_VULNERABILITIES_PROMPT,
  GATHER_CONTEXT_PROMPT,
  JUDGE_FINDINGS_PROMPT,
  RANK_FILES_PROMPT,
  REFINE_VULNERABILITIES_PROMPT,
} from "./prompts.ts";
import { AuditorState, CandidateFindingSchema, FileRankingSchema, JudgeReviewSchema } from "./state.ts";
import { buildRepoTree } from "./tools/repo-tree/tool.ts";
import { analyzeSolidityFile } from "./tools/solidity-analyzer/tool.ts";
import { buildReviewBlocks, matchLines } from "./utils.ts";

const llmHaiku = createLLM("anthropic", { model: "claude-haiku-4-5", maxTokens: 20000 });
const llmOpus = createLLM("anthropic", { model: "claude-opus-4-8", temperature: null, maxTokens: 20000 });
const llmSonnet = createLLM("anthropic", { model: "claude-sonnet-4-6", maxTokens: 20000 });

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
  logger.info(`defineScope: walking repo at ${state.repoPath}`);

  const solFiles: string[] = [];
  const docFiles: string[] = [];

  walkDirectory(state.repoPath, 0, solFiles, docFiles);

  const fileTree = buildRepoTree(state.repoPath);

  logger.info(`defineScope: found ${solFiles.length} Solidity file(s), ${docFiles.length} doc file(s)`);
  logger.debug(`defineScope: Solidity files: ${JSON.stringify(solFiles)}`);
  logger.debug(`defineScope: doc files: ${JSON.stringify(docFiles)}`);
  logger.debug(`defineScope: file tree:\n${fileTree}`);

  logger.info("defineScope: ranking files by importance");

  const RankFilesSchema = z.object({ rankings: z.array(FileRankingSchema) });
  const rankingModel = llmHaiku.withStructuredOutput(RankFilesSchema);

  const { rankings } = await rankingModel.invoke([
    new SystemMessage({ content: [{ type: "text", text: RANK_FILES_PROMPT, cache_control: { type: "ephemeral" } }] }),
    new HumanMessage(
      `Árvore de arquivos:\n\`\`\`\n${fileTree}\n\`\`\`\n\nArquivos Solidity para classificar:\n${solFiles.map((f) => `- ${f}`).join("\n")}`,
    ),
  ]);

  const sorted = [...rankings].sort((a, b) => b.importance - a.importance);
  logger.info(
    `defineScope: rankings:\n${sorted.map((r) => `  [${r.importance}/5] ${r.filePath} — ${r.reasoning}`).join("\n")}`,
  );

  const importantFiles = sorted.filter((r) => r.importance >= MIN_FILE_IMPORTANCE).map((r) => r.filePath);
  const skipped = solFiles.length - importantFiles.length;
  if (skipped > 0) {
    logger.info(`defineScope: skipping ${skipped} low-importance file(s) (importance < ${MIN_FILE_IMPORTANCE})`);
  }

  return { scope: importantFiles, docs: docFiles, fileTree, fileRankings: sorted };
};

const gatherContext: GraphNode<typeof AuditorState> = async (state) => {
  logger.info(`gatherContext: processing ${state.scope.length} Solidity file(s) and ${state.docs.length} doc file(s)`);

  const readFile = (filePath: string): string => {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  };

  const solidityEntries: { filePath: string; source: string; analysis: string }[] = [];
  for (const filePath of state.scope) {
    const source = readFile(filePath).slice(0, MAX_SOL_CHARS);
    if (!source) continue;

    const ranking = state.fileRankings.find((r) => r.filePath === filePath);
    const mode = ranking && ranking.importance >= 4 ? "full" : "short";
    const analysis = await analyzeSolidityFile(source, mode, filePath, ranking?.importance);
    solidityEntries.push({ filePath, source, analysis });
  }

  const docEntries: { filePath: string; content: string }[] = [];
  for (const filePath of state.docs) {
    const content = readFile(filePath).slice(0, MAX_DOC_CHARS);
    if (content) docEntries.push({ filePath, content });
  }

  const parts: string[] = [];

  if (docEntries.length > 0) {
    parts.push("## Documentação\n");
    for (const { filePath, content } of docEntries) {
      parts.push(`### ${filePath}\n${content}`);
    }
  }

  parts.push(`## Árvore de Arquivos\n\n\`\`\`\n${state.fileTree}\n\`\`\``);

  parts.push("## Análise Estrutural\n");
  for (const { analysis } of solidityEntries) {
    parts.push(analysis);
  }

  const model = llmHaiku.withStructuredOutput(z.object({ context: z.string() }));
  const result = await model.invoke([
    new SystemMessage({ content: [{ type: "text", text: GATHER_CONTEXT_PROMPT, cache_control: { type: "ephemeral" } }] }),
    new HumanMessage(parts.join("\n\n")),
  ]);

  const fileTreeBlock = `## Árvore de Arquivos\n\n\`\`\`\n${state.fileTree}\n\`\`\``;
  const structuralBlock = `## Análise Estrutural dos Contratos\n\n${solidityEntries.map(({ analysis }) => analysis).join("\n\n---\n\n")}`;
  const repoContext = [result.context, fileTreeBlock, structuralBlock].join("\n\n");

  logger.debug(`gatherContext: full context:\n${parts.join("\n\n")}`);
  logger.info(`gatherContext: context built (${repoContext.length} chars)`);
  logger.debug(`gatherContext: compact context:\n${repoContext}`);

  return { repoContext };
};

const findVulnerabilities: GraphNode<typeof AuditorState> = async (state) => {
  const model = llmOpus.withStructuredOutput(z.object({ findings: z.array(CandidateFindingSchema) }));

  const isReflection = state.judgeReviews.length > 0;

  logger.info(
    `findVulnerabilities: invoking LLM for ${state.scope.length} file(s) in parallel (iteration ${state.reflectionCount + 1})`,
  );

  const cachedContext = { type: "text" as const, text: `Contexto do Protocolo:\n${state.repoContext}`, cache_control: { type: "ephemeral" as const } };

  const allFindings = await Promise.all(
    state.scope.map(async (filePath) => {
      let source: string;
      try {
        source = fs.readFileSync(filePath, "utf-8").slice(0, MAX_SOL_CHARS);
      } catch {
        return [];
      }
      if (!source) return [];

      const fileEntries = isReflection
        ? state.candidateFindings
            .map((f, i) => ({ finding: f, review: state.judgeReviews[i] }))
            .filter(({ finding }) => finding.path === filePath)
        : [];

      const isRefinement = fileEntries.length > 0;
      const promptText = isRefinement ? REFINE_VULNERABILITIES_PROMPT : FIND_VULNERABILITIES_PROMPT;
      const contractText = isRefinement
        ? `Contrato (${filePath}):\n\n${source}\n\n${buildReviewBlocks(fileEntries, state.reflectionCount)}`
        : `Contrato (${filePath}):\n\n${source}`;

      logger.debug(`findVulnerabilities: processing ${filePath}`);

      const result = await model.invoke([
        new SystemMessage({ content: [{ type: "text", text: promptText, cache_control: { type: "ephemeral" } }] }),
        new HumanMessage({ content: [cachedContext, { type: "text", text: contractText }] }),
      ]);

      return result.findings.map((finding: any) => ({
        ...finding,
        path: filePath,
        location: matchLines(source, finding.codeSnippet) ?? "",
      }));
    }),
  );

  const candidateFindings = allFindings.flat();
  logger.info(`findVulnerabilities: LLM returned ${candidateFindings.length} total candidate finding(s)`);
  logger.debug(`findVulnerabilities: findings:\n${JSON.stringify(candidateFindings, null, 2)}`);

  return { candidateFindings };
};

const judgeFindings: GraphNode<typeof AuditorState> = async (state) => {
  if (state.candidateFindings.length === 0) {
    logger.info("judgeFindings: no candidate findings to review, skipping LLM call");
    return {
      judgeReviews: [],
      findings: [],
      reflectionCount: state.reflectionCount + 1,
    };
  }

  const model = llmSonnet.withStructuredOutput(JudgeReviewSchema);

  logger.info(`judgeFindings: reviewing ${state.candidateFindings.length} candidate finding(s) in parallel`);

  const cachedContext = { type: "text" as const, text: `Contexto do Protocolo:\n${state.repoContext}`, cache_control: { type: "ephemeral" as const } };

  const reviews = await Promise.all(
    state.candidateFindings.map(async (finding, i) => {
      let source: string;
      try {
        source = fs.readFileSync(finding.path, "utf-8").slice(0, MAX_SOL_CHARS);
      } catch {
        source = "";
      }

      const findingText = `[Achado ${i + 1}] ${finding.title}\nSeveridade: ${finding.severity}\nDescrição: ${finding.description}\nLocalização: ${finding.path} linhas ${finding.location}\nCódigo:\n\`\`\`solidity\n${finding.codeSnippet}\n\`\`\``;

      logger.debug(`judgeFindings: reviewing finding ${i + 1}: ${finding.title}`);
      return model.invoke([
        new SystemMessage({ content: [{ type: "text", text: JUDGE_FINDINGS_PROMPT, cache_control: { type: "ephemeral" } }] }),
        new HumanMessage({
          content: [
            cachedContext,
            { type: "text", text: `Contrato (${finding.path}):\n\n${source}\n\nAchado para Revisão:\n\n${findingText}` },
          ],
        }),
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

  logger.info(`judgeFindings: ${findings.length} confirmed, ${falsePositiveCount} false positive(s)`);
  logger.debug(`judgeFindings: reviews:\n${JSON.stringify(reviews, null, 2)}`);

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

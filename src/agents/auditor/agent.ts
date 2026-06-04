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
  SKIP_DIRS,
  SOL_EXT,
  SOL_TEST_SUFFIXES,
} from "./config.ts";
import {
  FIND_VULNERABILITIES_PROMPT,
  GATHER_CONTEXT_PROMPT,
  JUDGE_FINDINGS_PROMPT,
  RANK_FILES_PROMPT,
} from "./prompts.ts";
import { AuditorState, CandidateFindingSchema, FileRankingSchema, JudgeReviewSchema } from "./state.ts";
import { buildRepoTree } from "./tools/repo-tree/tool.ts";
import { analyzeSolidityFile } from "./tools/solidity-analyzer/tool.ts";
import { matchLines } from "./utils.ts";

const llmHaiku = createLLM("anthropic", { model: "claude-haiku-4-5", maxTokens: 20000 });
const llmOpus = createLLM("anthropic", { model: "claude-opus-4-8", maxTokens: 20000 });
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
    new SystemMessage(RANK_FILES_PROMPT),
    new HumanMessage(
      `File tree:\n\`\`\`\n${fileTree}\n\`\`\`\n\nSolidity files to rank:\n${solFiles.map((f) => `- ${f}`).join("\n")}`,
    ),
  ]);

  const sorted = [...rankings].sort((a, b) => b.importance - a.importance);
  logger.info(
    `defineScope: rankings:\n${sorted.map((r) => `  [${r.importance}/5] ${r.filePath} — ${r.reasoning}`).join("\n")}`,
  );

  return { scope: solFiles, docs: docFiles, fileTree, fileRankings: sorted };
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
    parts.push("## Documentation\n");
    for (const { filePath, content } of docEntries) {
      parts.push(`### ${filePath}\n${content}`);
    }
  }

  parts.push("## Structural Analysis\n");
  for (const { analysis } of solidityEntries) {
    parts.push(analysis);
  }

  const model = llmHaiku.withStructuredOutput(z.object({ context: z.string() }));
  const result = await model.invoke([new SystemMessage(GATHER_CONTEXT_PROMPT), new HumanMessage(parts.join("\n\n"))]);

  logger.debug(`gatherContext: full context:\n${parts.join("\n\n")}`);
  logger.info(`gatherContext: context built (${result.context.length} chars)`);
  logger.debug(`gatherContext: compact context:\n${result.context}`);

  return { repoContext: result.context };
};

const findVulnerabilities: GraphNode<typeof AuditorState> = async (state) => {
  const model = llmOpus.withStructuredOutput(z.object({ findings: z.array(CandidateFindingSchema) }));

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
    `findVulnerabilities: invoking LLM for ${state.scope.length} file(s) in parallel (iteration ${state.reflectionCount + 1})`,
  );

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

      logger.debug(`findVulnerabilities: processing ${filePath}`);

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

  const reviews = await Promise.all(
    state.candidateFindings.map(async (finding, i) => {
      let source: string;
      try {
        source = fs.readFileSync(finding.path, "utf-8").slice(0, MAX_SOL_CHARS);
      } catch {
        source = "";
      }

      const findingText = `[Finding ${i + 1}] ${finding.title}\nSeverity: ${finding.severity}\nDescription: ${finding.description}\nLocation: ${finding.path} lines ${finding.location}\nCode:\n\`\`\`solidity\n${finding.codeSnippet}\n\`\`\``;

      logger.debug(`judgeFindings: reviewing finding ${i + 1}: ${finding.title}`);
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

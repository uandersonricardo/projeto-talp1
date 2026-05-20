import fs from "node:fs";
import path from "node:path";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, type GraphNode, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import { logger } from "../../logger.ts";
import { judgeFindingsModel, findVulnerabilitiesModel, gatherContextModel } from "./model.ts";
import { JUDGE_FINDINGS_PROMPT, FIND_VULNERABILITIES_PROMPT, GATHER_CONTEXT_PROMPT } from "./prompts.ts";
import { AuditorState, ReviewSchema, PartialFindingSchema } from "./state.ts";
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

  return { scope: solFiles, docs: docFiles, fileTree };
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

  // Read and analyze each Solidity file
  const solidityEntries: { filePath: string; source: string; analysis: string }[] = [];
  for (const filePath of state.scope) {
    const source = readFile(filePath).slice(0, MAX_SOL_CHARS);
    if (!source) continue;
    const analysis = await analyzeSolidityFile(source, "full");
    solidityEntries.push({ filePath, source, analysis });
  }

  // Concatenate all sources for downstream vulnerability phases
  const solidityFile = solidityEntries
    .map(({ filePath, source }) => `// === FILE: ${filePath} ===\n${source}`)
    .join("\n\n");

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

  // const model = gatherContextModel.withStructuredOutput(z.object({ context: z.string() }));
  // const result = await model.invoke([new SystemMessage(GATHER_CONTEXT_PROMPT), new HumanMessage(parts.join("\n\n"))]);

  logger.info(`gatherContext: context built (${parts.join("\n\n").length} chars)`);
  logger.debug(`gatherContext: full context:\n${parts.join("\n\n")}`);

  return { solidityFile, repoContext: parts.join("\n\n") };
};

const findVulnerabilities: GraphNode<typeof AuditorState> = async (state) => {
  const model = findVulnerabilitiesModel.withStructuredOutput(z.object({ findings: z.array(PartialFindingSchema) }));

  let userMessage = `Contract:\n\n${state.solidityFile}\n\nProtocol Context:\n${state.repoContext}`;

  if (state.judgeReviews.length > 0) {
    const feedback = state.judgeReviews
      .map(
        (r) => `- "${r /*.title*/}": ${r.isFalsePositive ? "FALSE POSITIVE" : "TRUE POSITIVE"}\n  Judge: ${r.review}`,
      )
      .join("\n");
    userMessage += `\n\nJudge feedback from previous iteration (iteration ${state.reflectionCount}):\n${feedback}\n\nRevise your findings accordingly.`;
  }

  logger.info(`findVulnerabilities: invoking LLM (iteration ${state.reflectionCount + 1})`);
  logger.debug(`findVulnerabilities: user message:\n${userMessage}`);

  const result = await model.invoke([new SystemMessage(FIND_VULNERABILITIES_PROMPT), new HumanMessage(userMessage)]);

  logger.info(`findVulnerabilities: LLM returned ${result.findings.length} candidate finding(s)`);
  logger.debug(`findVulnerabilities: findings:\n${JSON.stringify(result.findings, null, 2)}`);

  return { candidateFindings: result.findings.map((finding: any) => ({ ...finding, path: "/", location: "1-14" })) };
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

  const model = findVulnerabilitiesModel.withStructuredOutput(z.object({ reviews: z.array(ReviewSchema) }));

  const findingsText = state.candidateFindings
    .map(
      (f, i) =>
        `[Finding ${i + 1}] ${f.title}\nSeverity: ${f.severity}\nDescription: ${f.description}\nLocation: ${f.path} lines ${f.location}\nCode:\n\`\`\`solidity\n${f.codeSnippet}\n\`\`\``,
    )
    .join("\n\n---\n\n");

  logger.info(`judgeFindings: reviewing ${state.candidateFindings.length} candidate finding(s)`);
  logger.debug(`judgeFindings: findings text:\n${findingsText}`);

  const result = await model.invoke([
    new SystemMessage(JUDGE_FINDINGS_PROMPT),
    new HumanMessage(
      `Contract:\n\n${state.solidityFile}\n\nProtocol Context:\n${state.repoContext}\n\nCandidate Findings to Review:\n\n${findingsText}`,
    ),
  ]);

  const reviewsByTitle = new Map(result.reviews.map((r: any) => [r.findingTitle.toLowerCase(), r]));

  const confirmedFindings = state.candidateFindings.filter((f, i) => {
    const review = reviewsByTitle.get(f.title.toLowerCase()) ?? result.reviews[i];
    return review ? !review.isFalsePositive : true;
  });

  const falsePositiveCount = state.candidateFindings.length - confirmedFindings.length;
  logger.info(`judgeFindings: ${confirmedFindings.length} confirmed, ${falsePositiveCount} false positive(s)`);
  logger.debug(`judgeFindings: reviews:\n${JSON.stringify(result.reviews, null, 2)}`);

  return {
    judgeReviews: result.reviews,
    findings: confirmedFindings,
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

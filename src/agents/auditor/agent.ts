import fs from "node:fs";
import path from "node:path";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, type GraphNode, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import { auditorModel } from "./model.ts";
import { CRITIC_FINDINGS_PROMPT, FIND_VULNERABILITIES_PROMPT, GATHER_CONTEXT_PROMPT } from "./prompts.ts";
import { AuditorState, CriticSchema, FindingSchema } from "./state.ts";
import { analyzeSolidityFile } from "./tools/solidity-analyzer-tool.ts";
import {
  DOC_BASENAMES,
  DOC_EXTS,
  MAX_DEPTH,
  MAX_DOC_CHARS,
  MAX_REFLECTIONS,
  MAX_SOL_CHARS,
  SKIP_DIRS,
  SOL_EXT,
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
        solFiles.push(fullPath);
      } else if (DOC_EXTS.has(ext) || DOC_BASENAMES.has(base)) {
        docFiles.push(fullPath);
      }
    }
  }
};

const defineScope: GraphNode<typeof AuditorState> = async (state) => {
  const solFiles: string[] = [];
  const docFiles: string[] = [];

  walkDirectory(state.repoPath, 0, solFiles, docFiles);

  return { scope: solFiles, docs: docFiles };
};

const gatherContext: GraphNode<typeof AuditorState> = async (state) => {
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
    const analysis = await analyzeSolidityFile(source, "short");
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

  const model = auditorModel.withStructuredOutput(z.object({ context: z.string() }));
  const result = await model.invoke([new SystemMessage(GATHER_CONTEXT_PROMPT), new HumanMessage(parts.join("\n\n"))]);

  return { solidityFile, repoContext: result.context };
};

const findVulnerabilities: GraphNode<typeof AuditorState> = async (state) => {
  const model = auditorModel.withStructuredOutput(z.object({ findings: z.array(FindingSchema) }));

  let userMessage = `Contract:\n\n${state.solidityFile}\n\nProtocol Context:\n${state.repoContext}`;

  if (state.criticReviews.length > 0) {
    const feedback = state.criticReviews
      .map(
        (r) =>
          `- "${r.findingTitle}": ${r.isFalsePositive ? "FALSE POSITIVE" : "TRUE POSITIVE"}\n  Critic: ${r.review}`,
      )
      .join("\n");
    userMessage += `\n\nCritic feedback from previous iteration (iteration ${state.reflectionCount}):\n${feedback}\n\nRevise your findings accordingly.`;
  }

  const result = await model.invoke([new SystemMessage(FIND_VULNERABILITIES_PROMPT), new HumanMessage(userMessage)]);

  return { candidateFindings: result.findings };
};

const criticFindings: GraphNode<typeof AuditorState> = async (state) => {
  if (state.candidateFindings.length === 0) {
    return {
      criticReviews: [],
      findings: [],
      reflectionCount: state.reflectionCount + 1,
    };
  }

  const model = auditorModel.withStructuredOutput(z.object({ reviews: z.array(CriticSchema) }));

  const findingsText = state.candidateFindings
    .map(
      (f, i) =>
        `[Finding ${i + 1}] ${f.title}\nSeverity: ${f.severity} | Auditor confidence: ${f.confidence}/100\nDescription: ${f.description}\nLocation: ${f.path} lines ${f.location}\nCode:\n\`\`\`solidity\n${f.codeSnippet}\n\`\`\`\nExploit paths:\n${f.exploitablePaths.map((p) => `  - ${p}`).join("\n")}`,
    )
    .join("\n\n---\n\n");

  const result = await model.invoke([
    new SystemMessage(CRITIC_FINDINGS_PROMPT),
    new HumanMessage(
      `Contract:\n\n${state.solidityFile}\n\nProtocol Context:\n${state.repoContext}\n\nCandidate Findings to Review:\n\n${findingsText}`,
    ),
  ]);

  const reviewsByTitle = new Map(result.reviews.map((r) => [r.findingTitle.toLowerCase(), r]));

  const confirmedFindings = state.candidateFindings.filter((f, i) => {
    const review = reviewsByTitle.get(f.title.toLowerCase()) ?? result.reviews[i];
    return review ? !review.isFalsePositive : true;
  });

  return {
    criticReviews: result.reviews,
    findings: confirmedFindings,
    reflectionCount: state.reflectionCount + 1,
  };
};

export const auditorAgent = new StateGraph(AuditorState)
  .addNode("defineScope", defineScope)
  .addNode("gatherContext", gatherContext)
  .addNode("findVulnerabilities", findVulnerabilities)
  .addNode("criticFindings", criticFindings)
  .addEdge(START, "defineScope")
  .addEdge("defineScope", "gatherContext")
  .addEdge("gatherContext", "findVulnerabilities")
  .addEdge("findVulnerabilities", "criticFindings")
  .addConditionalEdges("criticFindings", (state) => {
    const hasFalsePositives = state.criticReviews.some((r) => r.isFalsePositive);
    if (hasFalsePositives && state.reflectionCount < MAX_REFLECTIONS) {
      return "findVulnerabilities";
    }
    return END;
  })
  .compile();

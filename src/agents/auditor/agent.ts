import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, type GraphNode, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import { auditorModel } from "./model.ts";
import {
  CRITIC_FINDINGS_PROMPT,
  FIND_VULNERABILITIES_PROMPT,
  GATHER_CONTEXT_PROMPT,
} from "./prompts.ts";
import { AuditorState, CriticSchema, FindingSchema } from "./state.ts";

const MAX_REFLECTIONS = 3;

const gatherContext: GraphNode<typeof AuditorState> = async (state) => {
  const model = auditorModel.withStructuredOutput(z.object({ context: z.string() }));

  const scopeNote =
    state.scope.length > 0 ? `\nAudit scope (focus on these): ${state.scope.join(", ")}` : "";

  const result = await model.invoke([
    new SystemMessage(GATHER_CONTEXT_PROMPT),
    new HumanMessage(`Analyze this smart contract:${scopeNote}\n\n${state.solidityFile}`),
  ]);

  return { repoContext: result.context };
};

const findVulnerabilities: GraphNode<typeof AuditorState> = async (state) => {
  const model = auditorModel.withStructuredOutput(
    z.object({ findings: z.array(FindingSchema) }),
  );

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

  const result = await model.invoke([
    new SystemMessage(FIND_VULNERABILITIES_PROMPT),
    new HumanMessage(userMessage),
  ]);

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

  const model = auditorModel.withStructuredOutput(
    z.object({ reviews: z.array(CriticSchema) }),
  );

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
  .addNode("gatherContext", gatherContext)
  .addNode("findVulnerabilities", findVulnerabilities)
  .addNode("criticFindings", criticFindings)
  .addEdge(START, "gatherContext")
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

import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const PartialFindingSchema = z.object({
  title: z.string(),
  description: z.string(),
  recommendation: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  codeSnippet: z.string(),
});

export const FindingSchema = z.object({
  title: z.string(),
  description: z.string(),
  recommendation: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  codeSnippet: z.string(),
  location: z.string(),
  path: z.string(),
});

export const ReviewSchema = z.object({
  review: z.string(),
  isFalsePositive: z.boolean(),
  confidence: z.number(),
  exploitablePaths: z.array(z.string()),
});

export const AuditorState = new StateSchema({
  repoPath: z.string().default(""),
  solidityFile: z.string().default(""),
  scope: z.array(z.string()).default([]),
  docs: z.array(z.string()).default([]),
  fileTree: z.string().default(""),
  repoContext: z.string().default(""),
  candidateFindings: z.array(FindingSchema).default([]),
  judgeReviews: z.array(ReviewSchema).default([]),
  findings: z.array(FindingSchema).default([]),
  reflectionCount: z.number().default(0),
});

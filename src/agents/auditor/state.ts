import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const FindingSchema = z.object({
  title: z.string(),
  description: z.string(),
  recommendation: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  confidence: z.number(),
  codeSnippet: z.string(),
  location: z.string(),
  path: z.string(),
  exploitablePaths: z.array(z.string()),
});

export const CriticSchema = z.object({
  findingTitle: z.string(),
  review: z.string(),
  isFalsePositive: z.boolean(),
  confidence: z.number(),
  exploitablePaths: z.array(z.string()),
});

export const AuditorState = new StateSchema({
  solidityFile: z.string().default(""),
  scope: z.array(z.string()).default([]),
  repoContext: z.string().default(""),
  candidateFindings: z.array(FindingSchema).default([]),
  criticReviews: z.array(CriticSchema).default([]),
  findings: z.array(FindingSchema).default([]),
  reflectionCount: z.number().default(0),
});

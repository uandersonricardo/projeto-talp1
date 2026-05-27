import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const CandidateFindingSchema = z.object({
  title: z.string(),
  description: z.string(),
  recommendation: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  codeSnippet: z.string(),
});

export const LocatedFindingSchema = CandidateFindingSchema.extend({
  location: z.string(),
  path: z.string(),
});

export const JudgeReviewSchema = z.object({
  review: z.string(),
  isFalsePositive: z.boolean(),
  confidence: z.number(),
  exploitablePaths: z.array(z.string()),
});

export const FindingSchema = LocatedFindingSchema.extend({
  judgeReview: z.object({
    review: z.string(),
    confidence: z.number(),
    exploitablePaths: z.array(z.string()),
  }),
});

export const AuditorState = new StateSchema({
  repoPath: z.string().default(""),
  scope: z.array(z.string()).default([]),
  docs: z.array(z.string()).default([]),
  fileTree: z.string().default(""),
  repoContext: z.string().default(""),
  candidateFindings: z.array(LocatedFindingSchema).default([]),
  judgeReviews: z.array(JudgeReviewSchema).default([]),
  findings: z.array(FindingSchema).default([]),
  reflectionCount: z.number().default(0),
});

import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const CoderState = new StateSchema({
  requirements: z.array(z.string()).default([]),
  contract: z.string().default(""),
  compilationErrors: z.array(z.string()).default([]),
  reviewSummary: z.string().default(""),
});

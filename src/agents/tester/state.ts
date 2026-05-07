import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const TesterState = new StateSchema({
  solidityFiles: z.array(z.string()).default([]),
  vulnerability: z.record(z.string(), z.any()).default({}),
  results: z.array(z.any()).default([]),
});

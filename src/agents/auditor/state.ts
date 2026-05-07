import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const AuditorState = new StateSchema({
  solidityFile: z.string().default(""),
  vulnerabilities: z.array(z.record(z.string(), z.any())).default([]),
});

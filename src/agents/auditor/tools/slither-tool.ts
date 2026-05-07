import { tool } from "langchain";
import { z } from "zod";

export const slitherTool = tool(
  async (_input) => {
    return [];
  },
  {
    name: "slither",
    description: "Run slither static analysis on a Solidity contract.",
    schema: z.object({
      solidityFile: z.string().describe("The Solidity source code to analyze."),
    }),
  },
);

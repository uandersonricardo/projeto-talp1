import { tool } from "langchain";
import { z } from "zod";

export const searchTool = tool(
  async ({ query }) => {
    if (query.toLowerCase().includes("sf") || query.toLowerCase().includes("san francisco")) {
      return "It's 60 degrees and foggy.";
    }
    return "It's 90 degrees and sunny.";
  },
  {
    name: "search",
    description: "Call to surf the web.",
    schema: z.object({
      query: z.string().describe("The query to use in your search."),
    }),
  },
);

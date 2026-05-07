import { ChatOpenRouter } from "@langchain/openrouter";

export const model = new ChatOpenRouter({
  model: "claude-3-7-sonnet-latest",
});

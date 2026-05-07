import { ChatOpenRouter } from "@langchain/openrouter";

export const auditorModel = new ChatOpenRouter({
  model: "moonshotai/kimi-k2.6",
});

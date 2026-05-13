import { ChatAnthropic } from "@langchain/anthropic";

export const auditorModel = new ChatAnthropic({
  model: "claude-sonnet-4-6",
});

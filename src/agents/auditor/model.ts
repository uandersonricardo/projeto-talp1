import { ChatAnthropic } from "@langchain/anthropic";

export const gatherContextModel = new ChatAnthropic({
  model: "claude-haiku-4-5",
});

export const findVulnerabilitiesModel = new ChatAnthropic({
  model: "claude-sonnet-4-6",
});

export const judgeFindingsModel = new ChatAnthropic({
  model: "claude-sonnet-4-6",
});

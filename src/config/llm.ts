import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export type LLMProvider = "google" | "openrouter";

export function createLLM(overrideProvider?: LLMProvider): BaseChatModel {
  const provider = overrideProvider || (process.env.LLM_PROVIDER as LLMProvider) || "google";

  switch (provider) {
    case "openrouter": {
      const { ChatOpenRouter } = require("@langchain/openrouter");
      return new ChatOpenRouter({
        model: process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash",
        temperature: 0.2,
      }) as BaseChatModel;
    }
    case "google":
    default:
      return new ChatGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_API_KEY || "",
        model: process.env.MODEL_NAME || "gemini-2.5-flash",
        temperature: 0.2,
      });
  }
}

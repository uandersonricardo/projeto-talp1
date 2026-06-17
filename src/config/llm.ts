import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenRouter } from "@langchain/openrouter";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export type LLMProvider = "google" | "openrouter" | "anthropic";

export interface LLMOptions {
  model?: string;
  temperature?: number | null;
  maxTokens?: number;
}

export function createLLM(overrideProvider?: LLMProvider, options?: LLMOptions): BaseChatModel {
  const provider = overrideProvider || (process.env.LLM_PROVIDER as LLMProvider) || "openrouter";

  switch (provider) {
    case "openrouter":
      return new ChatOpenRouter({
        model: options?.model || process.env.OPENROUTER_MODEL || "google/gemini-3.1-flash-lite",
        ...(options?.temperature !== null && { temperature: options?.temperature ?? 0.2 }),
        apiKey: process.env.OPENROUTER_API_KEY,
        maxTokens: options?.maxTokens ?? 4096,
      });

    case "anthropic":
      return new ChatAnthropic({
        model: options?.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        ...(options?.temperature !== null && { temperature: options?.temperature ?? 0.2 }),
        apiKey: process.env.ANTHROPIC_API_KEY,
        maxTokens: options?.maxTokens ?? 4096,
      });

    case "google":
    default:
      return new ChatGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_API_KEY || "",
        model: options?.model || process.env.MODEL_NAME || "gemini-2.5-flash",
        ...(options?.temperature !== null && { temperature: options?.temperature ?? 0.2 }),
        maxOutputTokens: options?.maxTokens ?? 4096,
      });
  }
}

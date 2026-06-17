import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { VulnerabilityReport } from "./types.js";

export const PoCStateAnnotation = Annotation.Root({
  report: Annotation<VulnerabilityReport>(),

  pocCode: Annotation<string>({
    default: () => "",
    reducer: (_, y) => y,           // overwrite — full combined file
  }),

  templateCode: Annotation<string>({
    default: () => "",
    reducer: (_, y) => y,           // overwrite — only imports and setUp
  }),

  exploitBody: Annotation<string>({
    default: () => "",
    reducer: (_, y) => y,           // overwrite — only the hack logic
  }),

  infrastructurePhase: Annotation<boolean>({
    default: () => true,
    reducer: (_, y) => y,           // overwrite — true while fixing imports
  }),

  vulnerabilityAnalysis: Annotation<string>({
    default: () => "",
    reducer: (_, y) => y,           // overwrite
  }),

  executionLogs: Annotation<string[]>({
    default: () => [],
    reducer: (x, y) => x.concat(y), // append — never lose previous logs
  }),

  messages: Annotation<BaseMessage[]>({
    default: () => [],
    reducer: (x, y) => x.concat(y),
  }),

  toolCallCount: Annotation<number>({
    default: () => 0,
    reducer: (x, y) => x + y,
  }),

  totalCost: Annotation<number>({
    default: () => 0,
    reducer: (x, y) => x + y,
  }),

  lastError: Annotation<string | null>({
    default: () => null,
    reducer: (_, y) => y,           // overwrite — last error analysis
  }),

  iterations: Annotation<number>({
    default: () => 0,
    reducer: (x, y) => x + y,       // additive — incremented by +1 per call
  }),

  infraIterations: Annotation<number>({
    default: () => 0,
    reducer: (x, y) => x + y,       // additive
  }),

  exploitIterations: Annotation<number>({
    default: () => 0,
    reducer: (x, y) => x + y,       // additive
  }),

  compileFailures: Annotation<number>({
    default: () => 0,
    reducer: (x, y) => x + y,       // additive — incremented on each compile failure
  }),

  status: Annotation<"running" | "success" | "failed" | "timeout">({
    default: () => "running",
    reducer: (_, y) => y,           // overwrite
  }),
});

export type PoCState = typeof PoCStateAnnotation.State;

import { Annotation } from "@langchain/langgraph";
import { VulnerabilityReport, OracleContext } from "./types.js";

export const PoCStateAnnotation = Annotation.Root({
  report: Annotation<VulnerabilityReport>(),

  oracleContext: Annotation<OracleContext | null>({
    default: () => null,
    reducer: (_, y) => y,           // overwrite — filled once by oracleNode
  }),

  pocCode: Annotation<string>({
    default: () => "",
    reducer: (_, y) => y,           // overwrite — always latest version
  }),

  vulnerabilityAnalysis: Annotation<string>({
    default: () => "",
    reducer: (_, y) => y,           // overwrite
  }),

  executionLogs: Annotation<string[]>({
    default: () => [],
    reducer: (x, y) => x.concat(y), // append — never lose previous logs
  }),

  lastError: Annotation<string | null>({
    default: () => null,
    reducer: (_, y) => y,           // overwrite — last error analysis
  }),

  iterations: Annotation<number>({
    default: () => 0,
    reducer: (x, y) => x + y,       // additive — incremented by +1 per call
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

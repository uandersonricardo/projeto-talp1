export interface Finding {
  title: string;
  description: string;
  recommendation: string;
  severity: "high" | "medium" | "low";
  codeSnippet: string;
  location: string;
  path: string;
  judgeReview: {
    review: string;
    confidence: number;
    exploitablePaths: string[];
  };
}

export interface CoderResult {
  contract: string;
  compilationErrors: string[];
  reviewSummary: string;
}

export interface AuditorResult {
  findings: Finding[];
}

export interface TesterResult {
  status: "success" | "failed" | "timeout" | "skipped" | "running";
  pocCode?: string;
  executionLogs?: string[];
  iterations: number;
}

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface PipelineStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface AgentState {
  id: "coder" | "auditor" | "tester";
  label: string;
  color: string;
  status: StepStatus;
  steps: PipelineStep[];
}

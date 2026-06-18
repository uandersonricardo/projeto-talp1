import type { AgentState, StepStatus } from "../types";

export interface StepEvent {
  agent: "coder" | "auditor" | "tester";
  step: string;
  status: "running" | "done" | "error" | "skipped";
  detail?: string;
}

export const INITIAL_AGENT_STATES: AgentState[] = [
  {
    id: "coder",
    label: "CODER",
    color: "#58a6ff",
    status: "pending",
    steps: [
      { id: "coder.gen", label: "Gerando contrato", status: "pending" },
      { id: "coder.compile", label: "Compilando", status: "pending" },
      { id: "coder.review", label: "Revisando segurança", status: "pending" },
    ],
  },
  {
    id: "auditor",
    label: "AUDITOR",
    color: "#d29922",
    status: "pending",
    steps: [
      { id: "audit.scope", label: "Mapeando escopo", status: "pending" },
      { id: "audit.ctx", label: "Coletando contexto", status: "pending" },
      { id: "audit.find", label: "Analisando vulnerabilidades", status: "pending" },
      { id: "audit.judge", label: "Julgando findings", status: "pending" },
    ],
  },
  {
    id: "tester",
    label: "TESTER",
    color: "#3fb950",
    status: "pending",
    steps: [
      { id: "test.gen", label: "Codificando PoC (LLM)", status: "pending" },
      { id: "test.run", label: "Executando Sandbox (Ferramentas)", status: "pending" },
    ],
  },
];

const AGENT_ORDER = ["coder", "auditor", "tester"] as const;

const STEP_PREFIX: Record<string, string> = {
  coder: "coder.",
  auditor: "audit.",
  tester: "test.",
};

export function applyStepEvent(states: AgentState[], event: StepEvent): AgentState[] {
  const s = states.map((a) => ({ ...a, steps: a.steps.map((st) => ({ ...st })) }));

  const fullStepId = STEP_PREFIX[event.agent] + event.step;

  if (event.status === "running") {
    // Mark all preceding agents as done when a new agent starts its first step
    const agentIndex = AGENT_ORDER.indexOf(event.agent);
    for (let i = 0; i < agentIndex; i++) {
      const prev = s.find((a) => a.id === AGENT_ORDER[i]);
      if (prev && prev.status !== "done" && prev.status !== "error") {
        prev.status = "done";
        prev.steps.forEach((st) => {
          if (st.status === "pending") st.status = "done";
        });
      }
    }

    const agent = s.find((a) => a.id === event.agent);
    if (agent && agent.status === "pending") agent.status = "running";
  }

  // Update the step
  const step = s.flatMap((a) => a.steps).find((st) => st.id === fullStepId);
  if (step) {
    step.status = event.status;
    if (event.detail !== undefined) step.detail = event.detail;
  }

  // When a step finishes, check if all steps are settled → update agent status
  if (event.status !== "running") {
    const agent = s.find((a) => a.id === event.agent);
    if (agent) {
      const settled: StepStatus[] = ["done", "error", "skipped"];
      const allSettled = agent.steps.every((st) => settled.includes(st.status));
      if (allSettled) {
        const hasError = agent.steps.some((st) => st.status === "error");
        const allSkipped = agent.steps.every((st) => st.status === "skipped");
        agent.status = hasError ? "error" : allSkipped ? "skipped" : "done";
      }
    }
  }

  return s;
}

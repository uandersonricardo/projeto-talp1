import { useEffect, useRef } from "react";

import type { AgentState, StepStatus } from "../types";

const C = {
  bg: "#0d1117",
  surface: "#161b22",
  border: "#21262d",
  text: "#c9d1d9",
  muted: "#8b949e",
  dim: "#484f58",
  accent: "#58a6ff",
  green: "#3fb950",
  red: "#f85149",
  yellow: "#d29922",
};

const AGENT_COLORS: Record<string, string> = {
  coder: "#58a6ff",
  auditor: "#d29922",
  tester: "#3fb950",
};

const DEFAULT_REQUIREMENT = `Crie um contrato de staking com as seguintes características:
- Usuários podem depositar ETH e receber créditos proporcionais ao valor
- O owner pode pausar e retomar os depósitos
- Função de saque que devolve ETH proporcional ao crédito do usuário
- Acumula recompensas de 1% ao dia sobre o saldo depositado
- Emite eventos para depósito, saque e distribuição de recompensas`;

interface Props {
  requirements: string;
  onRequirementsChange: (v: string) => void;
  onRun: (e: React.FormEvent) => void;
  running: boolean;
  agentStates: AgentState[];
  logs: string[];
}

export function ControlPanel({ requirements, onRequirementsChange, onRun, running, agentStates, logs }: Props) {
  return (
    <div
      style={{
        width: 400,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        overflow: "hidden",
      }}
    >
      <Header />
      <InputForm requirements={requirements} onChange={onRequirementsChange} onRun={onRun} running={running} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <PipelineStatus agents={agentStates} running={running} />
        <TerminalLog logs={logs} />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div
      style={{
        padding: "14px 18px 10px",
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.accent, letterSpacing: "0.05em" }}>TALP1</span>
        <span style={{ fontSize: 10, color: C.dim }}>v0.1</span>
      </div>
      <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>multi-agent smart contract pipeline</div>
    </div>
  );
}

function InputForm({
  requirements,
  onChange,
  onRun,
  running,
}: {
  requirements: string;
  onChange: (v: string) => void;
  onRun: (e: React.FormEvent) => void;
  running: boolean;
}) {
  const canRun = !running && requirements.trim().length > 0;

  return (
    <form
      onSubmit={onRun}
      style={{
        padding: "12px 18px",
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>
        requisitos
      </div>
      <textarea
        value={requirements}
        onChange={(e) => onChange(e.target.value)}
        disabled={running}
        rows={5}
        placeholder="Descreva o smart contract a ser gerado, auditado e testado..."
        style={{
          width: "100%",
          padding: "10px 12px",
          fontSize: 12,
          fontFamily: "inherit",
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 5,
          color: C.text,
          resize: "none",
          outline: "none",
          lineHeight: 1.65,
          transition: "border-color 0.15s",
        }}
        onFocus={(e) => (e.target.style.borderColor = `${C.accent}60`)}
        onBlur={(e) => (e.target.style.borderColor = C.border)}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_REQUIREMENT)}
          disabled={running}
          style={{
            padding: "7px 10px",
            fontSize: 11,
            fontFamily: "inherit",
            background: "transparent",
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            color: C.muted,
            cursor: running ? "default" : "pointer",
            opacity: running ? 0.4 : 1,
            whiteSpace: "nowrap",
          }}
        >
          usar exemplo
        </button>
        <button
          type="submit"
          disabled={!canRun}
          style={{
            flex: 1,
            padding: "7px 14px",
            fontSize: 12,
            fontFamily: "inherit",
            fontWeight: 600,
            background: canRun ? C.accent : "transparent",
            border: `1px solid ${canRun ? C.accent : C.border}`,
            borderRadius: 4,
            color: canRun ? "#fff" : C.dim,
            cursor: canRun ? "pointer" : "default",
            transition: "all 0.15s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
          }}
        >
          {running && (
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: "1.5px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff",
                display: "inline-block",
                animation: "spin 0.7s linear infinite",
                flexShrink: 0,
              }}
            />
          )}
          {running ? "executando..." : "▶  executar"}
        </button>
      </div>
    </form>
  );
}

function PipelineStatus({ agents, running }: { agents: AgentState[]; running: boolean }) {
  const anyActive = agents.some((a) => a.status === "running");

  return (
    <div
      style={{
        flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        padding: "10px 0",
        maxHeight: 280,
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 18px 6px",
        }}
      >
        <span style={{ fontSize: 10, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>pipeline</span>
        {anyActive && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: C.accent,
              animation: "pulse 1.2s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
        )}
      </div>

      {agents.map((agent) => (
        <AgentBlock key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

function AgentBlock({ agent }: { agent: AgentState }) {
  const color = AGENT_COLORS[agent.id] ?? C.muted;
  const isRunning = agent.status === "running";
  const isDone = agent.status === "done";
  const isError = agent.status === "error";
  const isSkipped = agent.status === "skipped";

  return (
    <div style={{ padding: "4px 18px" }}>
      {/* Agent header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
        <AgentDot status={agent.status} color={color} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: isDone || isRunning ? color : C.dim,
          }}
        >
          {agent.label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: isDone ? C.green : isError ? C.red : isSkipped ? C.dim : isRunning ? color : C.dim,
            opacity: isDone || isError || isSkipped || isRunning ? 1 : 0.5,
          }}
        >
          {isDone ? "done" : isError ? "error" : isSkipped ? "skip" : isRunning ? "running" : "pending"}
        </span>
      </div>

      {/* Steps */}
      <div style={{ paddingLeft: 20 }}>
        {agent.steps.map((step) => (
          <StepRow key={step.id} step={step} agentColor={color} />
        ))}
      </div>
    </div>
  );
}

function AgentDot({ status, color }: { status: StepStatus; color: string }) {
  if (status === "running") {
    return (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          border: `1.5px solid ${color}40`,
          borderTopColor: color,
          display: "inline-block",
          animation: "spin 0.7s linear infinite",
          flexShrink: 0,
        }}
      />
    );
  }
  if (status === "done") {
    return <span style={{ color, fontSize: 10, lineHeight: 1 }}>✓</span>;
  }
  if (status === "error") {
    return <span style={{ color: C.red, fontSize: 10, lineHeight: 1 }}>✗</span>;
  }
  if (status === "skipped") {
    return <span style={{ color: C.dim, fontSize: 10, lineHeight: 1 }}>–</span>;
  }
  return <span style={{ color: C.dim, fontSize: 10, lineHeight: 1 }}>○</span>;
}

function StepRow({
  step,
  agentColor,
}: {
  step: { label: string; status: StepStatus; detail?: string };
  agentColor: string;
}) {
  const isRunning = step.status === "running";
  const isDone = step.status === "done";
  const isError = step.status === "error";
  const isSkipped = step.status === "skipped";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 0",
        fontSize: 11,
        color: isDone ? C.muted : isRunning ? C.text : C.dim,
        animation: isRunning ? "fadein 0.15s ease" : undefined,
      }}
    >
      <span style={{ width: 10, flexShrink: 0, textAlign: "center" }}>
        {isDone ? (
          <span style={{ color: C.green, fontSize: 9 }}>✓</span>
        ) : isRunning ? (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              border: `1px solid ${agentColor}40`,
              borderTopColor: agentColor,
              display: "inline-block",
              animation: "spin 0.7s linear infinite",
            }}
          />
        ) : isError ? (
          <span style={{ color: C.red, fontSize: 9 }}>✗</span>
        ) : isSkipped ? (
          <span style={{ color: C.dim, fontSize: 9 }}>–</span>
        ) : (
          <span style={{ color: C.dim, fontSize: 9 }}>·</span>
        )}
      </span>
      <span>{step.label}</span>
      {step.detail && <span style={{ color: agentColor, fontSize: 10, opacity: 0.8 }}>{step.detail}</span>}
    </div>
  );
}

function logColor(log: string): string {
  if (log.includes("[Coder]")) return "#58a6ff";
  if (log.includes("[Auditor]")) return "#d29922";
  if (log.includes("[Tester]")) return "#3fb950";
  if (log.includes("[ERRO]") || log.toLowerCase().startsWith("error")) return "#f85149";
  if (log === "Pipeline concluído.") return "#3fb950";
  return "#6e7681";
}

function TerminalLog({ logs }: { logs: string[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <div
        style={{
          padding: "6px 18px 4px",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 10, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>terminal</span>
        {logs.length > 0 && <span style={{ fontSize: 10, color: C.dim }}>{logs.length} lines</span>}
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "10px 18px",
          background: "#070c10",
          fontSize: 11.5,
          lineHeight: 1.7,
        }}
      >
        {logs.length === 0 ? (
          <span style={{ color: C.dim }}>
            <BlinkCursor />
          </span>
        ) : (
          logs.map((log, i) => (
            <div
              key={i}
              style={{
                color: logColor(log),
                display: "flex",
                gap: 8,
                animation: "fadein 0.1s ease",
              }}
            >
              <span style={{ color: C.dim, userSelect: "none", flexShrink: 0 }}>›</span>
              <span style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{log}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function BlinkCursor() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 13,
        background: C.dim,
        verticalAlign: "middle",
        animation: "blink 1.2s step-end infinite",
        borderRadius: 1,
      }}
    />
  );
}

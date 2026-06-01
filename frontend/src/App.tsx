import { useState, useRef, useCallback } from "react";

import type { CoderResult, AuditorResult, TesterResult, AgentState } from "./types";
import { computeDiff, type DiffLine } from "./utils/diff";
import { INITIAL_AGENT_STATES, applyStepEvent, type StepEvent } from "./utils/status";
import { ArtifactPanel } from "./components/ArtifactPanel";
import { ControlPanel } from "./components/ControlPanel";

export type ArtifactTab = "contract" | "findings" | "poc";

export function App() {
  const [requirements, setRequirements] = useState("");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [coder, setCoder] = useState<CoderResult | null>(null);
  const [auditor, setAuditor] = useState<AuditorResult | null>(null);
  const [tester, setTester] = useState<TesterResult | null>(null);
  const [agentStates, setAgentStates] = useState<AgentState[]>(INITIAL_AGENT_STATES);
  const [selectedTab, setSelectedTab] = useState<ArtifactTab>("contract");
  const [contractDiff, setContractDiff] = useState<DiffLine[] | null>(null);
  const [pocDiff, setPocDiff] = useState<DiffLine[] | null>(null);
  const [diffMode, setDiffMode] = useState<Record<string, boolean>>({});

  const prevContract = useRef<string | null>(null);
  const prevPoc = useRef<string | null>(null);

  const appendLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
  }, []);

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requirements.trim() || running) return;

    setRunning(true);
    setLogs([]);
    setCoder(null);
    setAuditor(null);
    setTester(null);
    setAgentStates(INITIAL_AGENT_STATES);
    setContractDiff(null);
    setPocDiff(null);
    setSelectedTab("contract");

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Stream não disponível");

      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            switch (currentEvent) {
              case "log":
                appendLog(data);
                break;
              case "step": {
                const event: StepEvent = JSON.parse(data);
                setAgentStates((prev) => applyStepEvent(prev, event));
                break;
              }
              case "coder": {
                const result: CoderResult = JSON.parse(data);
                const hasPrev = prevContract.current !== null;
                const diff = computeDiff(prevContract.current, result.contract);
                prevContract.current = result.contract;
                setContractDiff(diff);
                setDiffMode((prev) => ({ ...prev, contract: hasPrev }));
                setCoder(result);
                setSelectedTab("contract");
                setAgentStates((prev) => {
                  const s = prev.map((a) => ({ ...a, steps: a.steps.map((st) => ({ ...st })) }));
                  const a = s.find((x) => x.id === "coder")!;
                  a.status = "done";
                  a.steps.forEach((st) => {
                    if (st.status !== "error") st.status = "done";
                  });
                  return s;
                });
                break;
              }
              case "auditor": {
                const result: AuditorResult = JSON.parse(data);
                setAuditor(result);
                if (result.findings.length > 0) setSelectedTab("findings");
                setAgentStates((prev) => {
                  const s = prev.map((a) => ({ ...a, steps: a.steps.map((st) => ({ ...st })) }));
                  const a = s.find((x) => x.id === "auditor")!;
                  a.status = "done";
                  a.steps.forEach((st) => {
                    if (st.status !== "error") st.status = "done";
                  });
                  return s;
                });
                break;
              }
              case "tester": {
                const result: TesterResult = JSON.parse(data);
                if (result.pocCode) {
                  const hasPrev = prevPoc.current !== null;
                  const diff = computeDiff(prevPoc.current, result.pocCode);
                  prevPoc.current = result.pocCode;
                  setPocDiff(diff);
                  setDiffMode((prev) => ({ ...prev, poc: hasPrev }));
                  setSelectedTab("poc");
                }
                setTester(result);
                setAgentStates((prev) => {
                  const s = prev.map((a) => ({ ...a, steps: a.steps.map((st) => ({ ...st })) }));
                  const a = s.find((x) => x.id === "tester")!;
                  if (result.status === "skipped") {
                    a.status = "skipped";
                    a.steps.forEach((st) => {
                      st.status = "skipped";
                    });
                  } else {
                    a.status = result.status === "success" ? "done" : "error";
                    a.steps.forEach((st) => {
                      if (st.status !== "error") st.status = "done";
                    });
                  }
                  return s;
                });
                break;
              }
              case "error":
                appendLog(`[ERRO] ${data}`);
                break;
            }
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      appendLog(`[ERRO] ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const toggleDiffMode = (key: string) => setDiffMode((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "#070c10",
        overflow: "hidden",
        color: "#c9d1d9",
      }}
    >
      <ControlPanel
        requirements={requirements}
        onRequirementsChange={setRequirements}
        onRun={handleRun}
        running={running}
        agentStates={agentStates}
        logs={logs}
      />
      <ArtifactPanel
        coder={coder}
        auditor={auditor}
        tester={tester}
        contractDiff={contractDiff}
        pocDiff={pocDiff}
        selectedTab={selectedTab}
        onSelectTab={setSelectedTab}
        diffMode={diffMode}
        onToggleDiff={toggleDiffMode}
      />
    </div>
  );
}

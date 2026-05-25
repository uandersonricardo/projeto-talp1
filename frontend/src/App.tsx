import { useState, useRef, useCallback } from "react";

interface Finding {
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

interface AgentResult {
  contract?: string;
  compilationErrors?: string[];
  reviewSummary?: string;
  findings?: Finding[];
  results?: unknown[];
}

export function App() {
  const [requirements, setRequirements] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [coderResult, setCoderResult] = useState<AgentResult | null>(null);
  const [auditorResult, setAuditorResult] = useState<AgentResult | null>(null);
  const [testerResult, setTesterResult] = useState<AgentResult | null>(null);
  const [running, setRunning] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const appendLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requirements.trim() || running) return;

    setRunning(true);
    setLogs([]);
    setCoderResult(null);
    setAuditorResult(null);
    setTesterResult(null);
    appendLog("Iniciando pipeline...");

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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
            console.log("event", currentEvent);
          } else if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            console.log("data", data);
            switch (currentEvent) {
              case "log":
                appendLog(data);
                break;
              case "coder":
                setCoderResult(JSON.parse(data));
                break;
              case "auditor":
                setAuditorResult(JSON.parse(data));
                break;
              case "tester":
                setTesterResult(JSON.parse(data));
                break;
              case "error":
                appendLog(`❌ ERRO: ${data}`);
                break;
            }
          }
        }
      }
    } catch (err) {
      appendLog(`❌ Erro de conexão: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Multi-Agent: Geração, Auditoria e Teste de Smart Contracts</h1>
        <p style={styles.subtitle}>
          Descreva um cenário ou requisito cuja solução seja um smart contract em Solidity. O sistema irá gerar,
          compilar, auditar e testar o contrato automaticamente.
        </p>
      </header>

      <form onSubmit={handleSubmit} style={styles.form}>
        <textarea
          value={requirements}
          onChange={(e) => setRequirements(e.target.value)}
          placeholder={
            "Ex: Crie um token ERC20 com as seguintes características:\n- Nome: MeuToken, Símbolo: MTK\n- Supply inicial de 1.000.000 tokens\n- Funções de mint (apenas owner) e burn\n- Pausável pelo owner"
          }
          style={styles.textarea}
          rows={6}
          disabled={running}
        />
        <button
          type="submit"
          disabled={running || !requirements.trim()}
          style={{
            ...styles.button,
            opacity: running || !requirements.trim() ? 0.5 : 1,
          }}
        >
          {running ? "Executando pipeline..." : "Executar Pipeline"}
        </button>
      </form>

      {/* Logs */}
      {logs.length > 0 && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>📋 Log de Execução</h2>
          <div style={styles.logBox}>
            {logs.map((log, i) => (
              <div key={i} style={styles.logLine}>
                {log}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </section>
      )}

      {/* Coder */}
      {coderResult && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>🔨 Agente Coder</h2>

          <h3 style={styles.subTitle}>Contrato Gerado</h3>
          <div style={styles.codeBox}>
            <pre style={styles.code}>{coderResult.contract}</pre>
          </div>

          {coderResult.compilationErrors && coderResult.compilationErrors.length > 0 && (
            <>
              <h3 style={{ ...styles.subTitle, color: "#ef4444" }}>Erros de Compilação</h3>
              <div style={{ ...styles.codeBox, borderColor: "#ef4444" }}>
                <pre style={styles.code}>{coderResult.compilationErrors.join("\n")}</pre>
              </div>
            </>
          )}

          {coderResult.reviewSummary && (
            <>
              <h3 style={styles.subTitle}>Revisão de Segurança</h3>
              <div style={styles.resultBox}>
                <p style={styles.resultText}>{coderResult.reviewSummary}</p>
              </div>
            </>
          )}
        </section>
      )}

      {/* Auditor */}
      {auditorResult && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>🔍 Agente Auditor</h2>
          {auditorResult.findings && auditorResult.findings.length > 0 ? (
            auditorResult.findings.map((f, i) => (
              <div key={i} style={{ ...styles.findingCard, borderColor: severityColor(f.severity) }}>
                <div style={styles.findingHeader}>
                  <span style={{ ...styles.severityBadge, background: severityColor(f.severity) }}>
                    {f.severity.toUpperCase()}
                  </span>
                  <span style={styles.findingTitle}>{f.title}</span>
                </div>
                <p style={styles.findingText}>{f.description}</p>
                <p style={{ ...styles.findingText, color: "#94a3b8" }}>
                  <strong>Localização:</strong> {f.location ?? "-"}
                </p>
                {f.codeSnippet && <pre style={styles.code}>{f.codeSnippet}</pre>}
                <p style={{ ...styles.findingText, color: "#94a3b8" }}>
                  <strong>Recomendação:</strong> {f.recommendation}
                </p>
                <p style={{ ...styles.findingText, color: "#64748b", fontSize: 12 }}>
                  Confiança: {Math.round(f.judgeReview.confidence)}% — {f.judgeReview.review}
                </p>
              </div>
            ))
          ) : (
            <div style={styles.resultBox}>
              <p style={styles.resultText}>Nenhuma vulnerabilidade encontrada.</p>
            </div>
          )}
        </section>
      )}

      {/* Tester */}
      {testerResult && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>🧪 Agente Tester</h2>
          <div style={styles.codeBox}>
            <pre style={styles.code}>
              {testerResult.results && testerResult.results.length > 0
                ? JSON.stringify(testerResult.results, null, 2)
                : "Nenhum resultado de teste gerado."}
            </pre>
          </div>
        </section>
      )}
    </div>
  );
}

const severityColor = (severity: string) => {
  switch (severity) {
    case "high":
      return "#ef4444";
    case "medium":
      return "#f97316";
    case "low":
      return "#eab308";
    default:
      return "#64748b";
  }
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 900,
    margin: "0 auto",
    padding: "32px 20px",
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    color: "#e2e8f0",
    background: "#0f172a",
    minHeight: "100vh",
  },
  header: {
    textAlign: "center",
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: "#f8fafc",
    margin: "0 0 12px",
    lineHeight: 1.3,
  },
  subtitle: {
    fontSize: 15,
    color: "#94a3b8",
    margin: 0,
    lineHeight: 1.6,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginBottom: 32,
  },
  textarea: {
    width: "100%",
    padding: 16,
    fontSize: 14,
    fontFamily: "inherit",
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#1e293b",
    color: "#e2e8f0",
    resize: "vertical",
    outline: "none",
    boxSizing: "border-box",
    lineHeight: 1.6,
  },
  button: {
    padding: "12px 24px",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 8,
    border: "none",
    background: "#3b82f6",
    color: "#fff",
    cursor: "pointer",
    transition: "background 0.2s",
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: "#f8fafc",
    marginBottom: 10,
  },
  subTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#94a3b8",
    marginTop: 14,
    marginBottom: 6,
  },
  logBox: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: 16,
    maxHeight: 220,
    overflowY: "auto",
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  },
  logLine: {
    padding: "2px 0",
    color: "#a5f3fc",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  codeBox: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: 16,
    maxHeight: 400,
    overflowY: "auto",
  },
  code: {
    margin: 0,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    color: "#a5f3fc",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  resultBox: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: 16,
  },
  resultText: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.6,
    color: "#cbd5e1",
    whiteSpace: "pre-wrap",
  },
  findingCard: {
    background: "#1e293b",
    border: "1px solid",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  findingHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  severityBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: "#fff",
    padding: "2px 8px",
    borderRadius: 4,
    letterSpacing: "0.05em",
  },
  findingTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "#f8fafc",
  },
  findingText: {
    margin: "4px 0",
    fontSize: 13,
    lineHeight: 1.6,
    color: "#cbd5e1",
  },
};

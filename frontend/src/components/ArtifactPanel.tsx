import type { CoderResult, AuditorResult, TesterResult, Finding } from "../types";
import type { DiffLine } from "../utils/diff";
import type { ArtifactTab } from "../App";

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
  orange: "#db6d28",
  addedBg: "rgba(46, 160, 67, 0.1)",
  removedBg: "rgba(248, 81, 73, 0.09)",
};

const SEVERITY_COLOR: Record<string, string> = {
  high: C.red,
  medium: C.yellow,
  low: "#58a6ff",
};

interface Props {
  coder: CoderResult | null;
  auditor: AuditorResult | null;
  tester: TesterResult | null;
  contractDiff: DiffLine[] | null;
  pocDiff: DiffLine[] | null;
  selectedTab: ArtifactTab;
  onSelectTab: (tab: ArtifactTab) => void;
  diffMode: Record<string, boolean>;
  onToggleDiff: (key: string) => void;
}

export function ArtifactPanel({
  coder,
  auditor,
  tester,
  contractDiff,
  pocDiff,
  selectedTab,
  onSelectTab,
  diffMode,
  onToggleDiff,
}: Props) {
  const findingCount = auditor?.findings?.length ?? 0;
  const hasPoc = !!tester?.pocCode;

  const treeItems: {
    id: ArtifactTab;
    icon: string;
    name: string;
    badge?: string;
    badgeColor?: string;
    available: boolean;
  }[] = [
    {
      id: "contract",
      icon: "◈",
      name: "Contract.sol",
      badge: coder ? "sol" : undefined,
      badgeColor: C.accent,
      available: !!coder,
    },
    {
      id: "findings",
      icon: "⚑",
      name: "findings/",
      badge: auditor ? (findingCount > 0 ? `${findingCount} issue${findingCount > 1 ? "s" : ""}` : "clean") : undefined,
      badgeColor: auditor ? (findingCount > 0 ? C.red : C.green) : C.dim,
      available: !!auditor,
    },
    {
      id: "poc",
      icon: "◈",
      name: "ExploitTest.t.sol",
      badge: tester ? tester.status : undefined,
      badgeColor: tester?.status === "success" ? C.green : tester?.status === "failed" ? C.red : C.yellow,
      available: hasPoc,
    },
  ];

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderLeft: `1px solid ${C.border}`,
        background: C.bg,
      }}
    >
      {/* Panel titlebar */}
      <div
        style={{
          height: 38,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 16px",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, color: C.dim, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          explorer
        </span>
      </div>

      {/* File tree */}
      <div
        style={{
          flexShrink: 0,
          borderBottom: `1px solid ${C.border}`,
          padding: "6px 0",
        }}
      >
        <div style={{ padding: "3px 16px 4px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: "0.08em" }}>▾</span>
          <span style={{ fontSize: 11, color: C.muted, letterSpacing: "0.05em" }}>artifacts</span>
        </div>
        {treeItems.map((item) => {
          const selected = selectedTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => item.available && onSelectTab(item.id)}
              disabled={!item.available}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "4px 16px 4px 28px",
                background: selected ? "rgba(88, 166, 255, 0.08)" : "transparent",
                border: "none",
                borderLeft: selected ? `2px solid ${C.accent}` : "2px solid transparent",
                cursor: item.available ? "pointer" : "default",
                textAlign: "left",
                color: selected ? C.text : item.available ? C.muted : C.dim,
                fontSize: 13,
                transition: "background 0.1s",
              }}
            >
              <span style={{ fontSize: 10, color: selected ? C.accent : item.available ? C.dim : "#2d333b" }}>
                {item.icon}
              </span>
              <span style={{ flex: 1 }}>{item.name}</span>
              {item.badge && (
                <span
                  style={{
                    fontSize: 10,
                    color: item.badgeColor,
                    padding: "1px 5px",
                    borderRadius: 3,
                    border: `1px solid ${item.badgeColor}30`,
                    background: `${item.badgeColor}12`,
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {selectedTab === "contract" && coder && contractDiff ? (
          <CodeViewer
            title="Contract.sol"
            diff={contractDiff}
            showDiff={diffMode["contract"] ?? false}
            onToggleDiff={() => onToggleDiff("contract")}
          />
        ) : selectedTab === "findings" && auditor ? (
          <FindingsViewer findings={auditor.findings} reviewSummary={coder?.reviewSummary} />
        ) : selectedTab === "poc" && tester?.pocCode && pocDiff ? (
          <CodeViewer
            title="ExploitTest.t.sol"
            diff={pocDiff}
            showDiff={diffMode["poc"] ?? false}
            onToggleDiff={() => onToggleDiff("poc")}
            status={tester.status}
            iterations={tester.iterations}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function CodeViewer({
  title,
  diff,
  showDiff,
  onToggleDiff,
  status,
  iterations,
}: {
  title: string;
  diff: DiffLine[];
  showDiff: boolean;
  onToggleDiff: () => void;
  status?: string;
  iterations?: number;
}) {
  const addedCount = diff.filter((l) => l.type === "added").length;
  const removedCount = diff.filter((l) => l.type === "removed").length;
  const totalLines = diff.filter((l) => l.type !== "removed").length;
  const hasDiff = addedCount > 0 || removedCount > 0;
  const hasChanges =
    diff.some((l) => l.type === "removed") ||
    diff.some((l) => l.type === "added" && diff.some((x) => x.type === "unchanged"));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Toolbar */}
      <div
        style={{
          height: 36,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          borderBottom: `1px solid ${C.border}`,
          gap: 10,
          flexShrink: 0,
          background: C.bg,
        }}
      >
        <span style={{ fontSize: 12, color: C.muted }}>{title}</span>
        {status && (
          <span
            style={{
              fontSize: 10,
              color: status === "success" ? C.green : status === "failed" ? C.red : C.yellow,
              padding: "1px 6px",
              border: `1px solid currentColor`,
              borderRadius: 3,
              opacity: 0.8,
            }}
          >
            {status}
          </span>
        )}
        {iterations !== undefined && iterations > 0 && (
          <span style={{ fontSize: 10, color: C.dim }}>{iterations} iter</span>
        )}
        <span style={{ flex: 1 }} />
        {hasDiff && (
          <>
            {hasChanges && (
              <span style={{ fontSize: 10, color: C.dim }}>
                <span style={{ color: C.green }}>+{addedCount}</span>{" "}
                <span style={{ color: C.red }}>-{removedCount}</span>
              </span>
            )}
            <button
              onClick={onToggleDiff}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                background: showDiff ? "rgba(88, 166, 255, 0.12)" : "transparent",
                border: `1px solid ${showDiff ? C.accent : C.border}`,
                color: showDiff ? C.accent : C.muted,
                cursor: "pointer",
                borderRadius: 3,
                fontFamily: "inherit",
              }}
            >
              diff
            </button>
          </>
        )}
        <span style={{ fontSize: 10, color: C.dim }}>{totalLines}L</span>
      </div>

      {/* Code */}
      <div style={{ flex: 1, overflow: "auto", background: "#0a0e14" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12.5,
            lineHeight: 1.65,
          }}
        >
          <tbody>
            {diff.map((dl, idx) => {
              if (!showDiff && dl.type === "removed") return null;
              const isAdded = showDiff && dl.type === "added";
              const isRemoved = showDiff && dl.type === "removed";
              return (
                <tr
                  key={idx}
                  style={{
                    background: isAdded ? C.addedBg : isRemoved ? C.removedBg : "transparent",
                  }}
                >
                  {showDiff && (
                    <td
                      style={{
                        width: 18,
                        textAlign: "center",
                        color: isAdded ? C.green : isRemoved ? C.red : "transparent",
                        fontSize: 11,
                        userSelect: "none",
                        paddingLeft: 8,
                        paddingRight: 4,
                      }}
                    >
                      {isAdded ? "+" : isRemoved ? "−" : " "}
                    </td>
                  )}
                  <td
                    style={{
                      width: 44,
                      textAlign: "right",
                      paddingRight: 14,
                      paddingLeft: 8,
                      color: isRemoved ? "#5e3535" : C.dim,
                      userSelect: "none",
                      fontSize: 11,
                    }}
                  >
                    {dl.lineNo > 0 ? dl.lineNo : ""}
                  </td>
                  <td
                    style={{
                      padding: "0 16px 0 0",
                      color: isAdded ? "#b5e3b5" : isRemoved ? "#e5a0a0" : C.text,
                      whiteSpace: "pre",
                      fontFamily: "inherit",
                    }}
                  >
                    {dl.line}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FindingsViewer({ findings, reviewSummary }: { findings: Finding[]; reviewSummary?: string }) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
      {/* Review summary */}
      {reviewSummary && (
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 10,
              color: C.dim,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            coder / security-review
          </div>
          <div
            style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: 14,
              fontSize: 12.5,
              color: C.muted,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
            }}
          >
            {reviewSummary}
          </div>
        </div>
      )}

      {/* Findings */}
      <div
        style={{
          fontSize: 10,
          color: C.dim,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        auditor / findings — {findings.length} issue{findings.length !== 1 ? "s" : ""}
      </div>

      {findings.length === 0 ? (
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: 16,
            color: C.green,
            fontSize: 13,
          }}
        >
          ✓ Nenhuma vulnerabilidade encontrada.
        </div>
      ) : (
        findings.map((f, i) => <FindingCard key={i} finding={f} index={i} />)
      )}
    </div>
  );
}

function FindingCard({ finding, index }: { finding: Finding; index: number }) {
  const color = SEVERITY_COLOR[finding.severity] ?? C.muted;

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 6,
        marginBottom: 12,
        overflow: "hidden",
        animation: "fadein 0.2s ease",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: color,
            padding: "2px 6px",
            border: `1px solid ${color}`,
            borderRadius: 3,
            letterSpacing: "0.1em",
            background: `${color}15`,
          }}
        >
          {finding.severity.toUpperCase()}
        </span>
        <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
          [{index + 1}] {finding.title}
        </span>
        {finding.location && <span style={{ marginLeft: "auto", fontSize: 10, color: C.dim }}>{finding.location}</span>}
      </div>

      {/* Body */}
      <div style={{ padding: 14 }}>
        <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.7, marginBottom: 10 }}>{finding.description}</p>

        {finding.codeSnippet && (
          <div
            style={{
              background: "#0a0e14",
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              padding: "8px 12px",
              marginBottom: 10,
              fontSize: 12,
              color: "#b5c0cc",
              whiteSpace: "pre",
              overflow: "auto",
              maxHeight: 140,
              fontFamily: "inherit",
            }}
          >
            {finding.codeSnippet}
          </div>
        )}

        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
          <span style={{ color: C.dim }}>recomendação: </span>
          {finding.recommendation}
        </div>

        <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>
          confiança: {Math.round(finding.judgeReview.confidence)}% — {finding.judgeReview.review}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: C.dim,
        gap: 12,
      }}
    >
      <div style={{ fontSize: 28, opacity: 0.3 }}>◈</div>
      <div style={{ fontSize: 12, letterSpacing: "0.05em" }}>aguardando execução do pipeline</div>
    </div>
  );
}

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  line: string;
  lineNo: number;
}

export function computeDiff(prev: string | null, next: string): DiffLine[] {
  const nextLines = next.split("\n");

  if (!prev) {
    return nextLines.map((line, i) => ({ type: "added", line, lineNo: i + 1 }));
  }
  if (prev === next) {
    return nextLines.map((line, i) => ({ type: "unchanged", line, lineNo: i + 1 }));
  }

  const prevLines = prev.split("\n");
  const m = prevLines.length;
  const n = nextLines.length;

  if (m > 600 || n > 600) {
    return nextLines.map((line, i) => ({ type: "added", line, lineNo: i + 1 }));
  }

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0) as number[]);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = prevLines[i - 1] === nextLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && prevLines[i - 1] === nextLines[j - 1]) {
      result.unshift({ type: "unchanged", line: nextLines[j - 1], lineNo: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", line: nextLines[j - 1], lineNo: j });
      j--;
    } else {
      result.unshift({ type: "removed", line: prevLines[i - 1], lineNo: 0 });
      i--;
    }
  }

  return result;
}

export function diffHasChanges(lines: DiffLine[]): boolean {
  return lines.some((l) => l.type !== "unchanged");
}

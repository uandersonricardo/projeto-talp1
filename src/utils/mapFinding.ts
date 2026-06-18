import type { VulnerabilityReport } from "../agents/tester/types.js";

/**
 * Maps a Finding from the Auditor to a VulnerabilityReport for the Tester.
 * Enriches the description with all available auditor context:
 * judge review, recommendation, exploit paths — giving the tester
 * maximum information to generate a precise, specific PoC.
 */
export function mapFindingToReport(
  finding: any,
  sourceCode: string,
  repoContext?: string
): VulnerabilityReport {
  const title = finding.title || "Unknown vulnerability";

  const nameMatch = finding.path?.match(/([^\/]+)\.sol$/);
  const contractName = nameMatch ? nameMatch[1] : "TargetContract";

  const exploitablePaths: string[] = finding.judgeReview?.exploitablePaths || [];

  // Build a rich description combining all auditor context
  const descriptionParts: string[] = [
    finding.description || "No description provided by auditor.",
  ];

  if (finding.judgeReview?.review) {
    descriptionParts.push(`\n## Judge Analysis\n${finding.judgeReview.review}`);
  }

  if (finding.recommendation) {
    descriptionParts.push(`\n## Recommended Fix\n${finding.recommendation}`);
  }

  if (exploitablePaths.length > 0) {
    descriptionParts.push(`\n## Exploit Paths (step-by-step)\n${exploitablePaths.map((p, i) => `${i + 1}. ${p}`).join("\n")}`);
  }

  if (repoContext) {
    descriptionParts.push(`\n## Protocol Context\n${repoContext.slice(0, 1500)}`);
  }

  // Infer vulnerability type from title/description when auditor doesn't provide one
  const inferType = (): string => {
    const text = `${title} ${finding.description || ""}`.toLowerCase();
    if (text.includes("reentr")) return "reentrancy";
    if (text.includes("access control") || text.includes("unauthorized")) return "access control";
    if (text.includes("overflow") || text.includes("underflow")) return "arithmetic";
    if (text.includes("flash loan")) return "flash loan";
    if (text.includes("oracle") || text.includes("price manipul")) return "oracle manipulation";
    if (text.includes("denial of service") || text.includes("dos")) return "denial of service";
    if (text.includes("front.run") || text.includes("sandwich")) return "front-running";
    return "logic error";
  };

  const severity = ["critical", "high", "medium", "low"].includes(finding.severity)
    ? finding.severity
    : "medium";

  return {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50),
    severity: severity as VulnerabilityReport["severity"],
    type: inferType(),
    title,
    description: descriptionParts.join("\n"),
    affectedContract: {
      name: contractName,
      sourceCode,
      sourceFilePath: finding.path,
    },
    attackVector: exploitablePaths[0] ?? finding.description?.slice(0, 120) ?? "Unknown",
    exploitablePaths,
    codeSnippet: finding.codeSnippet,
    location: finding.location,
    suggestedCheatcodes: [],
  };
}

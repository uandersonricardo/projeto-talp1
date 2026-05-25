import type { Finding, VulnerabilityReport } from "../agents/tester/types.js";

/**
 * Mapeia um achado (Finding) do Auditor para um relatório de vulnerabilidade (VulnerabilityReport)
 * compatível com o Gerador de PoCs (Tester).
 */
export function mapFindingToReport(finding: any, sourceCode: string): VulnerabilityReport {
  const title = finding.title || finding.type || "Unknown vulnerability";
  const description = finding.description || "No description provided by auditor.";
  
  const nameMatch = finding.path?.match(/([^\/]+)\.sol$/);
  const contractName = nameMatch ? nameMatch[1] : "TargetContract";

  const exploitablePaths = finding.judgeReview?.exploitablePaths || [];

  return {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50),
    severity: (finding.severity === "high" || finding.severity === "medium" || finding.severity === "low") 
               ? finding.severity : "low",
    type: finding.type || "custom",
    title,
    description,
    affectedContract: {
      name: contractName,
      sourceCode,
    },
    attackVector: exploitablePaths[0] ?? "Unknown vector",
    exploitablePaths,
    codeSnippet: finding.codeSnippet,
    location: finding.location
  };
}

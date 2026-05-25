import "dotenv/config";

import { auditorAgent } from "./agents/auditor/agent.js";
import { coderAgent } from "./agents/coder/agent.js";
import { testerAgent } from "./agents/tester/agent.js";
import type { VulnerabilityReport, Finding } from "./agents/tester/types.js";

const requirements = ["ERC20 token", "pausable", "ownable"];

const coderResult = await coderAgent.invoke({ requirements });
console.log("======= Coder =======");
// console.log(coderResult.contract);

const auditorResult = await auditorAgent.invoke({ solidityFile: coderResult.contract });
console.log("\n======= Auditor =======");
// console.log(auditorResult.vulnerabilities);

function mapFindingToReport(finding: Partial<Finding> & { type?: string; severity?: string }, sourceCode: string): VulnerabilityReport {
  const title = typeof finding.title === "string" && finding.title.trim().length > 0
    ? finding.title
    : typeof finding.type === "string" && finding.type.trim().length > 0
      ? finding.type
      : "Unknown vulnerability";

  const description = typeof finding.description === "string" && finding.description.trim().length > 0
    ? finding.description
    : "No description provided by auditor.";

  const nameMatch = finding.path?.match(/([^\/]+)\.sol$/);
  const contractName = nameMatch ? nameMatch[1] : "TargetContract";

  const exploitablePaths = Array.isArray(finding.judgeReview?.exploitablePaths)
    ? finding.judgeReview.exploitablePaths
    : [];

  const severity = finding.severity === "high" || finding.severity === "medium" || finding.severity === "low"
    ? finding.severity
    : "low";

  if (!finding.path || !finding.judgeReview) {
    console.warn("Auditor returned incomplete finding; using fallbacks for PoC generation.");
  }

  return {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50),
    severity,
    type: typeof finding.type === "string" && finding.type.trim().length > 0 ? finding.type : "custom",
    title,
    description,
    affectedContract: {
      name: contractName,
      sourceCode,
    },
    attackVector: exploitablePaths[0] ?? "Unknown vector",
    exploitablePaths,
    codeSnippet: typeof finding.codeSnippet === "string" ? finding.codeSnippet : undefined,
    location: typeof finding.location === "string" ? finding.location : undefined,
  };
}

if (auditorResult.vulnerabilities.length > 0) {
  const finding = auditorResult.vulnerabilities[0] as Finding;
  const report = mapFindingToReport(finding, coderResult.contract);

  const testerResult = await testerAgent.invoke({ report });

  console.log("\n======= Tester =======");
  console.log("Status:", testerResult.status);
  console.log("Iterations:", testerResult.iterations);
} else {
  console.log("\n======= Tester =======");
  console.log("Nenhuma vulnerabilidade encontrada pelo Auditor.");
}

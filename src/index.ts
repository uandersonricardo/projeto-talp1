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

function mapFindingToReport(finding: Finding, sourceCode: string): VulnerabilityReport {
  // Extract contract name from path (e.g., "contracts/CafeToken.sol" -> "CafeToken")
  const nameMatch = finding.path.match(/([^\/]+)\.sol$/);
  const contractName = nameMatch ? nameMatch[1] : "TargetContract";

  return {
    id: finding.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50),
    severity: finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low",
    type: "custom",
    title: finding.title,
    description: finding.description,
    affectedContract: {
      name: contractName,
      sourceCode: sourceCode,
    },
    attackVector: finding.judgeReview.exploitablePaths[0] || "Unknown vector",
    exploitablePaths: finding.judgeReview.exploitablePaths,
    codeSnippet: finding.codeSnippet,
    location: finding.location
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

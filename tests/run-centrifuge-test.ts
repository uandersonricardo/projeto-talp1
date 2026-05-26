import { testerAgent } from "../src/agents/tester/agent.js";
import { Finding, VulnerabilityReport } from "../src/agents/tester/types.js";
import { readFileSync } from "fs";

function mapFindingToReport(finding: Finding, sourceCode: string): VulnerabilityReport {
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

async function main() {
  const input = JSON.parse(readFileSync("src/agents/tester/data/input_centrifuge.json", "utf-8"));
  const sourceCode = readFileSync("tests/centrifuge_flat.sol", "utf-8");

  const report = mapFindingToReport(input, sourceCode);

  console.log("Iniciando execução do Agente Tester com Centrifuge Trajectory 008...");
  const result = await testerAgent.invoke({ report });

  console.log("\n======= Resultado =======");
  console.log("Status Final:", result.status);
  console.log("Iterações:", result.iterations);
  if (result.lastError) console.log("Último Erro:", result.lastError);
  
  console.log("\n======= Código Gerado =======");
  console.log(result.pocCode);
}

main().catch(console.error);

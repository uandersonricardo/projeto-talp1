import "dotenv/config";

import { auditorAgent } from "./agents/auditor/agent.ts";
import { coderAgent } from "./agents/coder/agent.ts";
import { testerAgent } from "./agents/tester/agent.ts";
import type { VulnerabilityReport } from "./agents/tester/types.ts";

const requirements = ["ERC20 token", "pausable", "ownable"];

const coderResult = await coderAgent.invoke({ requirements });
console.log("======= Coder =======");
// console.log(coderResult.contract);

const auditorResult = await auditorAgent.invoke({ solidityFile: coderResult.contract });
console.log("\n======= Auditor =======");
// console.log(auditorResult.vulnerabilities);

// Mapeamento temporário para satisfazer o novo estado do testerAgent
const mockReport: VulnerabilityReport = {
  id: "test-001",
  severity: "high",
  type: "reentrancy",
  title: "Vulnerabilidade Detectada",
  description: "Descrição da vulnerabilidade",
  affectedContract: {
    name: "Contract",
    sourceCode: coderResult.contract,
  },
  attackVector: "Vetor de ataque",
};

const testerResult = await testerAgent.invoke({
  report: mockReport,
});

console.log("\n======= Tester =======");
console.log("Status:", testerResult.status);
console.log("Iterations:", testerResult.iterations);

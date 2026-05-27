import "dotenv/config";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { auditorAgent } from "./agents/auditor/agent.js";
import { coderAgent } from "./agents/coder/agent.js";
import { testerAgent } from "./agents/tester/agent.js";
import { logger } from "./logger.js";
import type { VulnerabilityReport, Finding } from "./agents/tester/types.js";
import { mapFindingToReport } from "./utils/mapFinding.js";

const inputPath = process.argv[2];

if (!inputPath) {
  console.log("Uso: npm start -- <caminho-do-arquivo-de-requisitos>");
  console.log("Exemplo: npm start -- input/requirements.md");
  process.exit(1);
}

const requirementsText = readFileSync(resolve(inputPath), "utf-8");
console.log("Requisitos carregados de:", inputPath);

const coderResult = await coderAgent.invoke({ requirements: [requirementsText] });
console.log("======= Coder =======");

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, "agents/coder/outputs");
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "Contract.sol"), coderResult.contract, "utf-8");
writeFileSync(resolve(outputDir, "README.md"), requirementsText, "utf-8");
console.log("\nContrato e requisitos salvos em:", outputDir);

console.log("\n======= Auditor =======");
logger.info("Starting auditorAgent");

const auditorResult = await auditorAgent.invoke({ repoPath: outputDir });

logger.info("Agent completed");
logger.info(`Findings: ${auditorResult.findings.length}`);
for (const f of auditorResult.findings) {
  logger.info(`  [${f.severity.toUpperCase()}] ${f.title} — ${f.location}`);
}

if (auditorResult.findings.length > 0) {
  const finding = auditorResult.findings[0];
  const report = mapFindingToReport(finding, coderResult.contract);

  console.log("\n======= Tester =======");
  const testerResult = await testerAgent.invoke({ report });

  console.log("Status:", testerResult.status);
  console.log("Iterations:", testerResult.iterations);
} else {
  console.log("\n======= Tester =======");
  console.log("Nenhuma vulnerabilidade encontrada pelo Auditor.");
}

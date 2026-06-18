import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

import { coderAgent } from "./src/agents/coder/agent.js";
import { auditorAgent } from "./src/agents/auditor/agent.js";
import { testerAgent } from "./src/agents/tester/agent.js";
import { mapFindingToReport } from "./src/utils/mapFinding.js";

async function runFullFlow() {
  const reqPath = resolve("input/requirements.md");
  const requirements = readFileSync(reqPath, "utf-8");

  console.log("=== 1. CODER AGENT ===");
  console.log("Generating contract...");
  const coderResult = await coderAgent.invoke({ requirements: [requirements] });
  console.log(`Contract generated successfully (${coderResult.contract.length} bytes).`);
  console.log(`Compilation Errors: ${coderResult.compilationErrors.length}`);

  console.log("\n=== 2. AUDITOR AGENT ===");
  const outputDir = resolve(tmpdir(), `talp1-e2e-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "Contract.sol"), coderResult.contract, "utf-8");
  writeFileSync(resolve(outputDir, "README.md"), requirements, "utf-8");
  console.log(`Created temporary sandbox at: ${outputDir}`);

  const auditorResult = await auditorAgent.invoke({ repoPath: outputDir });
  console.log(`Findings found: ${auditorResult.findings.length}`);

  if (auditorResult.findings.length === 0) {
    console.log("No vulnerabilities found by Auditor. Injecting a fake finding to test Tester agent.");
    auditorResult.findings.push({
      title: "Função burn não respeita o estado de pausa",
      description: "A função `burn` permite que qualquer usuário queime seus próprios tokens, mas não possui o modificador `whenNotPaused`.",
      recommendation: "Adicionar o modificador `whenNotPaused` à função `burn`.",
      severity: "low",
      codeSnippet: "    function burn(uint256 amount) external {\n        _burn(msg.sender, amount);\n    }",
      path: resolve(outputDir, "Contract.sol"),
      location: "L78-80",
      judgeReview: {
        review: "Mocked review",
        isFalsePositive: false,
        confidence: 100,
        exploitablePaths: ["Call pause() then call burn() and it succeeds."]
      }
    } as any);
  }

  for (let i = 0; i < auditorResult.findings.length; i++) {
    const f = auditorResult.findings[i];
    console.log(`\n[Finding ${i + 1}] ${f.severity.toUpperCase()} - ${f.title}`);
    console.log(`Location: ${f.location}`);
  }

  console.log("\n=== 3. TESTER AGENT ===");
  // Only test the first finding, simulating server.ts
  const firstFinding = auditorResult.findings[0];
  
  const report = mapFindingToReport(
    firstFinding,
    coderResult.contract,
    auditorResult.repoContext
  );
  report.customSandboxDir = outputDir;

  console.log("Mapped Report for Tester:");
  console.log(`- ID: ${report.id}`);
  console.log(`- Type: ${report.type}`);
  console.log(`- Attack Vector: ${report.attackVector}`);
  console.log(`- Custom Sandbox Dir: ${report.customSandboxDir}`);
  console.log(`- Description length: ${report.description.length} chars (contains auditor context)`);

  const testerResult = await testerAgent.invoke({ report });
  
  console.log(`\n=== FINAL RESULT ===`);
  console.log(`Tester Status: ${testerResult.status}`);
  console.log(`Iterations: ${testerResult.iterations}`);
  if (testerResult.status === "success") {
    console.log(`\n--- GENERATED POC ---`);
    console.log(testerResult.pocCode || testerResult.solidityCode);
  } else {
    console.log("Tester failed to generate a working PoC.");
  }
}

runFullFlow().catch(console.error);

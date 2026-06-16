import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import { testerAgent } from "../agents/tester/agent.js";
import { VulnerabilityReport } from "../agents/tester/types.js";

const JSONL_FILE = path.join(process.cwd(), "data", "benchmark_synthetic.jsonl");
const TEMP_DIR = path.join(process.cwd(), "temp_eval_run");
const CSV_FILE = path.join(process.cwd(), "data", "synthetic_evaluation_results.csv");

async function parseJSONL(filepath: string) {
  const content = await fs.readFile(filepath, "utf8");
  return content.split("\n").filter(l => l.trim().length > 0).map(l => JSON.parse(l));
}

async function createEmptyFoundryProject(targetDir: string, sourceCode: string, contractName: string) {
  await fs.mkdir(targetDir, { recursive: true });
  execSync("forge init --no-git --force", { 
    cwd: targetDir,
    env: { ...process.env, PATH: `${process.env.PATH}:/home/tales/.foundry/bin` }
  });
  
  // Clean up default files
  await fs.rm(path.join(targetDir, "src", "Counter.sol"), { force: true });
  await fs.rm(path.join(targetDir, "test", "Counter.t.sol"), { force: true });
  await fs.rm(path.join(targetDir, "script", "Counter.s.sol"), { force: true });

  // Write vulnerable contract
  await fs.writeFile(path.join(targetDir, "src", `${contractName}.sol`), sourceCode);
}

function appendCsvRow(row: string[]) {
  const line = row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(";") + "\n";
  import("fs").then(m => m.appendFileSync(CSV_FILE, line));
}

async function runEvaluation() {
  const cases = await parseJSONL(JSONL_FILE);
  
  // Only evaluate 10 hard cases to match the amount of easy/intermediate cases
  const targetCases = cases.filter(c => c.complexity === "hard").slice(0, 10);
  console.log(`Iniciando avaliação para ${targetCases.length} projetos sintéticos difíceis...`);

  const csvHeaders = [
    "Task_ID",
    "Complexity",
    "Time_Sec",
    "Pass_at_1",
    "Tool_Calls",
    "Total_Cost_USD",
    "Final_Status",
    "Error_Msg"
  ];
  
  await fs.mkdir(path.join(process.cwd(), "data"), { recursive: true });
  await fs.writeFile(CSV_FILE, csvHeaders.join(";") + "\n");

  let totalCost = 0;
  let passed = 0;

  for (const c of targetCases) {
    console.log(`\n\n${"=".repeat(60)}`);
    console.log(`=== INICIANDO CASO: ${c.task_id} ===`);
    console.log(`${"=".repeat(60)}`);

    const startTime = Date.now();
    const sandboxDir = path.join(TEMP_DIR, c.repo_name);
    
    // Setup Forge
    const contractName = c.repo_name.replace(/-/g, ""); // Simplified contract name parsing
    await createEmptyFoundryProject(sandboxDir, c.source_code, contractName);

    const report: VulnerabilityReport = {
      id: c.task_id,
      severity: c.impact || "high",
      type: c.expected_vulnerability,
      title: c.task_id,
      description: c.annotation,
      affectedContract: { name: contractName, sourceCode: c.source_code, sourceFilePath: `src/${contractName}.sol` },
      attackVector: c.expected_vulnerability,
      customSandboxDir: sandboxDir
    };

    console.log(`[CENÁRIO SINTÉTICO] Gerando exploit para ${c.task_id}...`);
    
    const result = await testerAgent.invoke(
      { report },
      { 
        recursionLimit: 100,
        configurable: { sandboxDir }
      }
    ) as any;
    
    const timeSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const passAt1 = result.status === "success";
    const toolCalls = result.toolCallCount || 0;
    const cost = result.totalCost || 0;

    totalCost += cost;
    if (passAt1) passed++;

    console.log(`=> Status: ${result.status} | Tools: ${toolCalls} | Cost: $${cost.toFixed(2)} | Time: ${timeSec}s`);
    
    if (!passAt1) {
       console.log("--- LLM HISTORY ---");
       for (const m of result.messages) {
           console.log(`[${m._getType()}] ${m.content.substring(0, 200)}...`);
           if (m._getType() === "ai" && m.tool_calls) {
               console.log("Tool calls:", JSON.stringify(m.tool_calls));
           }
           if (m._getType() === "tool" && m.name === "smart_contract_test") {
               console.log("Test Output:", m.content);
           }
       }
       console.log("-------------------");
    }

    appendCsvRow([
      c.task_id,
      c.complexity,
      timeSec,
      passAt1 ? "TRUE" : "FALSE",
      toolCalls.toString(),
      cost.toFixed(4),
      result.status,
      result.lastError || ""
    ]);
  }

  console.log(`\n\nAVALIAÇÃO CONCLUÍDA!`);
  console.log(`Accuracy (Pass@1): ${((passed / targetCases.length) * 100).toFixed(1)}% (${passed}/${targetCases.length})`);
  console.log(`Total Cost: $${totalCost.toFixed(2)}`);
  console.log(`Resultados em: ${CSV_FILE}`);
}

runEvaluation().catch(err => {
  console.error("Fatal error during evaluation:", err);
  process.exit(1);
});

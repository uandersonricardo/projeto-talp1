import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { coderAgent } from "../src/agents/coder/agent.ts";

// ─── Config ────────────────────────────────────────────────────────────────────
const FORMAL_EVAL_PATH =
  process.env.FORMAL_EVAL_PATH ??
  resolve("..", "formal-eval", "data", "FormalEval.jsonl");

const OUTPUT_PATH = process.env.BENCHMARK_OUTPUT ?? resolve("benchmarks", "samples.jsonl");
const SAMPLES_PER_TASK = Number(process.env.SAMPLES_PER_TASK ?? "1");
const SKIP_REVIEW = process.env.SKIP_REVIEW !== "false"; // skip review by default for speed

// ─── Types ─────────────────────────────────────────────────────────────────────
interface FormalEvalProblem {
  task_id: string;
  complexity: string;
  description: string;
  prompt: string;
  canonical_solution: string;
  test: string;
  entry_point: string;
}

interface SampleOutput {
  task_id: string;
  completion: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function readProblems(path: string): FormalEvalProblem[] {
  const content = readFileSync(path, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/**
 * Extrai a "completion" (body do contrato) a partir do contrato completo gerado.
 * O FormalEval espera: prompt + completion = contrato completo.
 * Então precisamos remover tudo que já está no prompt.
 */
function extractCompletion(generatedContract: string, prompt: string): string {
  // Estratégia 1: Se o contrato gerado contém o prompt exato, pegar o que vem depois
  const promptTrimmed = prompt.trimEnd();
  const idx = generatedContract.indexOf(promptTrimmed);
  if (idx !== -1) {
    return generatedContract.slice(idx + promptTrimmed.length);
  }

  // Estratégia 2: Encontrar a declaração "contract <Name> {" e pegar o body
  // O prompt sempre termina com "contract <Name> {\n"
  const contractDeclMatch = prompt.match(/contract\s+(\w+)\s*\{?\s*$/m);
  if (contractDeclMatch) {
    const contractName = contractDeclMatch[1];
    const pattern = new RegExp(`contract\\s+${contractName}\\s*\\{`);
    const match = generatedContract.match(pattern);
    if (match?.index !== undefined) {
      const afterDecl = generatedContract.slice(match.index + match[0].length);
      return afterDecl;
    }
  }

  // Estratégia 3: Fallback — Tenta remover pragma + imports + declaração até "{"
  const lines = generatedContract.split("\n");
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/contract\s+\w+.*\{/)) {
      bodyStart = i + 1;
      break;
    }
  }
  return lines.slice(bodyStart).join("\n");
}

/**
 * Adapta o prompt do FormalEval para ser interpretado pelo Coder Agent.
 * Inclui instrução explícita para gerar apenas o body.
 */
function buildRequirements(problem: FormalEvalProblem): string {
  return `Complete the following Solidity contract. Generate ONLY the contract body (state variables, functions, and closing brace "}").
Do NOT include the SPDX license, pragma, or contract declaration — they are already provided.
The code must compile with solc ^0.8.19.

Here is the contract declaration with its specification:

${problem.prompt}

IMPORTANT: Return ONLY the code that goes INSIDE the contract (after the opening brace). Include the closing "}" at the end.`;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(FORMAL_EVAL_PATH)) {
    console.error(`FormalEval dataset not found at: ${FORMAL_EVAL_PATH}`);
    console.error("Set FORMAL_EVAL_PATH env variable to the correct path.");
    process.exit(1);
  }

  const problems = readProblems(FORMAL_EVAL_PATH);
  console.log(`Loaded ${problems.length} problems from FormalEval`);
  console.log(`Generating ${SAMPLES_PER_TASK} sample(s) per task...`);
  console.log(`Output: ${OUTPUT_PATH}\n`);

  const samples: SampleOutput[] = [];
  let completed = 0;

  for (const problem of problems) {
    for (let s = 0; s < SAMPLES_PER_TASK; s++) {
      const label = `[${problem.task_id}] (${problem.complexity}) sample ${s + 1}/${SAMPLES_PER_TASK}`;
      console.log(`→ ${label}: ${problem.description}`);

      try {
        const requirements = buildRequirements(problem);
        const result = await coderAgent.invoke({ requirements: [requirements] });

        const generated = result.contract;
        const completion = extractCompletion(generated, problem.prompt);

        samples.push({ task_id: problem.task_id, completion });

        const hasErrors = result.compilationErrors.length > 0;
        console.log(`  ✓ Done${hasErrors ? ` (with ${result.compilationErrors.length} compile errors)` : ""}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ Failed: ${msg}`);
        // Still emit an empty completion so FormalEval doesn't complain about missing tasks
        samples.push({ task_id: problem.task_id, completion: "// generation failed\n}\n" });
      }

      completed++;
    }
  }

  // Write JSONL output
  const jsonl = samples.map((s) => JSON.stringify(s)).join("\n") + "\n";
  writeFileSync(OUTPUT_PATH, jsonl, "utf-8");

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Benchmark complete: ${completed} completions generated`);
  console.log(`Output saved to: ${OUTPUT_PATH}`);
  console.log(`\nTo evaluate, run:`);
  console.log(`  cd ../formal-eval && evaluate_formal_correctness ${resolve(OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

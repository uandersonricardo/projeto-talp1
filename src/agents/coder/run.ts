import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { coderAgent } from "./agent.ts";

const inputPath = process.argv[2];

if (!inputPath) {
  console.log("Uso: npx tsx src/agents/coder/run.ts <caminho-do-arquivo-de-requisitos>");
  console.log("Exemplo: npx tsx src/agents/coder/run.ts input/requirements.md");
  process.exit(1);
}

const requirementsText = readFileSync(resolve(inputPath), "utf-8");
console.log("Requisitos carregados de:", inputPath);
console.log("Gerando contrato...\n");

const result = await coderAgent.invoke({ requirements: [requirementsText] });

console.log("======= Contrato Gerado =======");
console.log(result.contract);
console.log("\n======= Erros de Compilação =======");
console.log(result.compilationErrors.length === 0 ? "Nenhum erro" : result.compilationErrors.join("\n"));
console.log("\n======= Revisão de Segurança =======");
console.log(result.reviewSummary);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, "outputs");
mkdirSync(outputDir, { recursive: true });
const outputPath = resolve(outputDir, "Contract.sol");
writeFileSync(outputPath, result.contract, "utf-8");
console.log("\nContrato salvo em:", outputPath);

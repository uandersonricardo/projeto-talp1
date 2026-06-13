import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import { testerAgent } from "../agents/tester/agent.js";
import { VulnerabilityReport, PoCResult } from "../agents/tester/types.js";
import { setupSandbox, applyPatchSmart, computePatchDiff } from "./runTesterBenchmark.js";

const DATASET_PATH = path.join(process.cwd(), "Proof-of-Patch-only-dataset");
const TEMP_DIR = path.join(process.cwd(), "temp_eval_run");
const CSV_FILE = path.join(process.cwd(), "data", "final_evaluation_results.csv");

async function runEvaluation() {
  const metadataStr = await fs.readFile(path.join(DATASET_PATH, "dataset_metadata.json"), "utf8");
  const metadata = JSON.parse(metadataStr);
  const cases = Object.keys(metadata);
  
  // Limitado a 1 projeto (054 - Cally) para observação empírica de simplicidade
  const targetCases = ["054"];
  console.log(`Iniciando avaliação final para ${targetCases.length} projetos...`);

  // Prepara o arquivo CSV
  const csvHeaders = [
    "ID",
    "Time_Sec",
    "Reproducible",
    "Specific",
    "False_Positive_Rejected",
    "A_Infra_Iters",
    "A_Exploit_Iters",
    "A_Final_Error",
    "B_Infra_Iters",
    "B_Exploit_Iters",
    "B_Final_Error",
    "PoC_Code",
    "Patch_Diff"
  ];
  
  await fs.mkdir(path.join(process.cwd(), "data"), { recursive: true });
  await fs.writeFile(CSV_FILE, csvHeaders.join(";") + "\n");

  for (const caseId of targetCases) {
    const data = metadata[caseId];
    console.log(`\n\n${"=".repeat(60)}`);
    console.log(`=== INICIANDO CASO: ${caseId} (${data.repo_name}) ===`);
    console.log(`${"=".repeat(60)}`);

    const startTime = Date.now();

    // ==========================================
    // CENÁRIO A: Verdadeiro Positivo (Vulnerável)
    // ==========================================
    console.log(`\n[CENÁRIO A] Testando reprodução real e especificidade...`);
    const setupInfo = await setupSandbox(caseId, data);
    
    if (!setupInfo) {
      console.log(`[${caseId}] Falha crítica no setup inicial.`);
      appendCsvRow([caseId, "0", "FALSE", "FALSE", "FALSE", "0", "SETUP_FAILED", "0", "", "", ""]);
      continue;
    }

    const sandboxDir = setupInfo;
    const targetPath = data.main_contract; // Path relative to project root
    let vulnerableCode = "";
    try {
      vulnerableCode = await fs.readFile(path.join(sandboxDir, targetPath), "utf8");
    } catch {
      vulnerableCode = "// Could not load source code";
    }
    
    // Ler o arquivo de teste de referência (se houver)
    let referenceTestCode = "";
    try {
      const allTestFiles = execSync(`find ${path.join(sandboxDir, "test")} -name "*.t.sol" -o -name "*.sol"`, { encoding: "utf8" })
        .split("\n").filter(Boolean);
      if (allTestFiles.length > 0) {
        referenceTestCode = await fs.readFile(allTestFiles[0], "utf8");
      }
    } catch(e) {}

    let patchDiff = "";
    try {
      const patchSourceDir = path.join(process.cwd(), DATASET_PATH, data.patch);
      const targetDir = path.join(process.cwd(), DATASET_PATH, data.target_directory);
      patchDiff = await computePatchDiff(patchSourceDir, path.join(sandboxDir, targetPath), targetDir, targetPath);
    } catch {}

    const reportA: VulnerabilityReport = {
      id: caseId,
      severity: data.impact || "high",
      type: data.expected_vulnerability,
      title: `${data.repo_name} - ${caseId}`,
      description: data.annotation,
      affectedContract: { name: targetPath.split("/").pop()!.replace(".sol", ""), sourceCode: vulnerableCode, sourceFilePath: targetPath },
      attackVector: data.expected_vulnerability,
      customSandboxDir: sandboxDir,
      referenceTestCode,
      patchDiff
    };

    const resultA = await testerAgent.invoke({ report: reportA }, { recursionLimit: 100 }) as PoCResult;
    let reproducible = resultA.status === "success";
    let specific = false;
    let pocCodeStr = "";

    // Se reproduziu, testa a especificidade aplicando o patch
    if (reproducible) {
      console.log(`\n[CENÁRIO A] Reproduzível! PoC gerado com sucesso. Testando especificidade no patch...`);
      pocCodeStr = resultA.pocCode || resultA.solidityCode;
      
      const patchApplied = await applyPatchSmart(caseId, sandboxDir);
      if (patchApplied) {
        // Escreve o teste na pasta (já patcheada)
        await fs.writeFile(path.join(sandboxDir, "test", "Exploit.t.sol"), pocCodeStr);
        const { runFoundry } = await import("../agents/tester/tools/foundryRunner.js");
        const specResult = await runFoundry(pocCodeStr, sandboxDir);
        
        if (specResult.exitCode !== 0) {
          console.log(`[CENÁRIO A] Especificidade CONFIRMADA! O teste falhou após o patch.`);
          specific = true;
        } else {
          console.log(`[CENÁRIO A] FALSO ESPECÍFICO! O teste continuou passando mesmo no código corrigido.`);
        }
      } else {
         console.log(`[CENÁRIO A] Falha ao aplicar patch. Assumindo especificidade FALSA.`);
      }
    }

    const lastErrorA = (resultA as any).lastError || (resultA.status === "success" ? "" : "TIMEOUT");

    // ==========================================
    // CENÁRIO B: Teste de Falso Positivo (Patch)
    // ==========================================
    console.log(`\n[CENÁRIO B] Testando rejeição de falso positivo (Robustez)...`);
    // Recria a sandbox do zero
    await execSync(`rm -rf ${sandboxDir}`);
    const setupInfoB = await setupSandbox(caseId, data);
    
    let falsePositiveRejected = false;
    let resultB: Partial<PoCResult> = { iterations: 0, status: "failed" };
    let lastErrorB = "";

    if (setupInfoB) {
      // Aplica o patch ANTES de chamar o agente (tornando o código seguro)
      const patchAppliedB = await applyPatchSmart(caseId, sandboxDir);
      
      if (patchAppliedB) {
        let patchedCode = "";
        try {
          patchedCode = await fs.readFile(path.join(sandboxDir, data.main_contract), "utf8");
        } catch {
          patchedCode = "// Could not load patched code";
        }
        
        // Passa a MESMA anotação (mentindo que é vulnerável)
        const reportB: VulnerabilityReport = {
          ...reportA,
          affectedContract: { name: targetPath.split("/").pop()!.replace(".sol", ""), sourceCode: patchedCode, sourceFilePath: targetPath },
          patchDiff: undefined // Oculta o patch diff do LLM para este cenário
        };

        resultB = await testerAgent.invoke({ report: reportB }, { recursionLimit: 100 }) as PoCResult;
        
        // Se falhou em gerar exploit, REJEITOU com sucesso o falso positivo!
        if (resultB.status !== "success") {
          console.log(`\n[CENÁRIO B] SUCESSO DE ROBUSTEZ! Agente não conseguiu hackear o código seguro.`);
          falsePositiveRejected = true;
        } else {
          console.log(`\n[CENÁRIO B] ALUCINAÇÃO CRÍTICA! Agente hackeou um código que já estava corrigido.`);
        }
        lastErrorB = (resultB as any).lastError || (resultB.status === "success" ? "" : "TIMEOUT");
      }
    }

    const totalTimeSec = Math.floor((Date.now() - startTime) / 1000);

    // Salva no CSV
    appendCsvRow([
      caseId,
      totalTimeSec.toString(),
      reproducible ? "TRUE" : "FALSE",
      specific ? "TRUE" : "FALSE",
      falsePositiveRejected ? "TRUE" : "FALSE",
      (resultA as any).infraIterations || 0,
      (resultA as any).exploitIterations || 0,
      lastErrorA,
      (resultB as any).infraIterations || 0,
      (resultB as any).exploitIterations || 0,
      lastErrorB,
      reproducible ? escapeCsv(pocCodeStr) : "",
      reproducible ? escapeCsv(patchDiff) : ""
    ]);

    console.log(`[${caseId}] Avaliação concluída em ${totalTimeSec}s. Salvo no CSV.`);
  }

  console.log(`\nAVALIAÇÃO FINAL CONCLUÍDA! Resultados em: ${CSV_FILE}`);
}

function escapeCsv(str: string) {
  if (!str) return "";
  // Troca aspas duplas por duplas aspas duplas (padrão CSV)
  return `"${str.replace(/"/g, '""')}"`;
}

async function appendCsvRow(columns: string[]) {
  const row = columns.join(";") + "\n";
  await fs.appendFile(CSV_FILE, row);
}

runEvaluation().catch(console.error);

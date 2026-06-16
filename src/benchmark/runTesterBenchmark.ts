import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from 'url';
import { testerAgent } from "../agents/tester/agent.js";
import { VulnerabilityReport } from "../agents/tester/types.js";
import "dotenv/config";

const execAsync = promisify(exec);
const DATASET_PATH = "Proof-of-Patch-only-dataset";
const METADATA_FILE = path.join(DATASET_PATH, "dataset_metadata.json");
const SUMMARY_FILE = "data/benchmark_summary.json";

/**
 * Smartly applies a patch by matching each patched .sol file to its
 * counterpart in tempPatchDir by stripping 1-3 directory prefix levels.
 * This handles nested patch structures like patches/003/2023-07-pooltogether/vault/src/Vault.sol
 * when tempPatchDir expects src/Vault.sol.
 */
export async function applyPatchSmart(caseId: string, sandboxDir: string): Promise<boolean> {
  const metadataContent = await fs.readFile(METADATA_FILE, "utf-8");
  const metadata = JSON.parse(metadataContent);
  const finding = metadata[caseId];
  const patchSourceDir = path.join(process.cwd(), DATASET_PATH, finding.patch);
  
  let stdout = "";
  try {
    ({ stdout } = await execAsync(
      `find "${patchSourceDir}" -name "*.sol" -not -path "*/lib/*" -not -path "*/node_modules/*" -type f`,
      { timeout: 15_000 }
    ));
  } catch {
    return false;
  }
  const patchFiles = stdout.trim().split("\n").filter(Boolean);
  let applied = 0;

  for (const patchFile of patchFiles) {
    const relFromPatch = path.relative(patchSourceDir, patchFile);
    const parts = relFromPatch.split("/");

    // Try stripping 1, 2, 3 prefix levels to find matching file in tempPatchDir
    let matched = false;
    for (let strip = 1; strip <= 3 && strip < parts.length; strip++) {
      const stripped = parts.slice(strip).join("/");
      const targetPath = path.join(sandboxDir, stripped);
      const exists = await fs.access(targetPath).then(() => true).catch(() => false);
      if (exists) {
        await execAsync(`cp "${patchFile}" "${targetPath}"`);
        console.log(`  [patch] Applied: ${stripped}`);
        applied++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      console.log(`  [patch] No match found for: ${relFromPatch}`);
    }
  }
  console.log(`  [patch] Applied ${applied}/${patchFiles.length} patch files.`);
  return applied > 0;
}

/**
 * Computes a unified diff of the main contract between vulnerable and patched versions.
 * Uses the same strip-depth matching as applyPatchSmart.
 */
export async function computePatchDiff(
  patchSourceDir: string,
  mainContractPath: string,
  targetDir: string,
  relativeContractPath: string
): Promise<string> {
  let diffOut = "";
  try {
    let stdout = "";
    try {
      ({ stdout } = await execAsync(
        `find "${patchSourceDir}" -name "${path.basename(relativeContractPath)}" -not -path "*/lib/*" -type f`,
        { timeout: 10_000 }
      ));
    } catch { return ""; }

    const patchedFile = stdout.trim().split("\n")[0];
    if (!patchedFile) return "";

    const { stdout: diff } = await execAsync(
      `diff -u "${mainContractPath}" "${patchedFile}"`,
      { timeout: 10_000 }
    ).catch(({ stdout: s }: any) => ({ stdout: s as string }));
    diffOut = (diff || "").trim().slice(0, 3000);
  } catch { /* ignore */ }
  return diffOut;
}

/**
 * Extracts the likely vulnerable file path from annotation text.
 * Looks for paths ending in .sol or github links.
 */
/**
 * Extracts the likely vulnerable file path from annotation text.
 */
function extractVulnerableFilePath(text: string): string | null {
  // Matches GitHub blob links: /blob/branch/path/to/File.sol
  const githubBlobRegex = /\/blob\/[^/]+\/([^#\s]+\.sol)/g;
  let match;
  if ((match = githubBlobRegex.exec(text)) !== null) {
    return match[1];
  }

  // Fallback to general .sol paths
  const solPathRegex = /(?:^|[\s])([a-zA-Z0-9._/-]+\.sol)(?:#L\d+)?/g;
  const paths: string[] = [];
  while ((match = solPathRegex.exec(text)) !== null) {
    const p = match[1];
    if (!p.includes("test/") && !p.includes("Test.sol")) {
      paths.push(p);
    }
  }

  // Prioritize paths containing "src"
  const srcPath = paths.find(p => p.includes("src/"));
  return srcPath || (paths.length > 0 ? paths[0] : null);
}


/**
 * Recursively finds a file by name within a directory, prioritizing src/
 */
export async function setupSandbox(caseId: string, data: any): Promise<string> {
    const targetDir = path.join(process.cwd(), DATASET_PATH, data.target_directory);
    const tempDir = path.join(process.cwd(), "temp_vuln_run", caseId);
    await execAsync(`mkdir -p temp_vuln_run && rm -rf ${tempDir} && cp -r ${targetDir} ${tempDir}`);
    


    await execAsync(`rm -rf ${tempDir}/.git`);
    try {
      await execAsync(`~/.foundry/bin/forge remappings > remappings.txt`, { cwd: tempDir, timeout: 10000 });
      console.log(`[setup] Regenerated remappings.txt with all nested submodules.`);
    } catch (e: any) {
      console.warn(`[setup] Failed to regenerate remappings: ${e.message}`);
    }
    return tempDir;
}

async function findFileRecursively(dir: string, fileName: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const subdirs: string[] = [];
  
  // Check files in current dir first
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
    if (entry.isDirectory() && entry.name !== "lib" && entry.name !== "node_modules") {
      subdirs.push(fullPath);
    }
  }

  // Prioritize "src" subdirectory if it exists
  const srcDir = subdirs.find(d => path.basename(d) === "src");
  if (srcDir) {
    const found = await findFileRecursively(srcDir, fileName);
    if (found) return found;
  }

  // Check other subdirs
  for (const subdir of subdirs) {
    if (path.basename(subdir) === "src") continue; // Already checked
    const found = await findFileRecursively(subdir, fileName);
    if (found) return found;
  }

  // Fallback to lib if nothing else found
  const libDir = entries.find(e => e.isDirectory() && e.name === "lib");
  if (libDir) {
    return findFileRecursively(path.join(dir, "lib"), fileName);
  }

  return null;
}

async function main() {
  const metadataContent = await fs.readFile(METADATA_FILE, "utf-8");
  const metadata = JSON.parse(metadataContent);
  const findingsIds = Object.keys(metadata);

  const limit = process.argv[2] ? parseInt(process.argv[2]) : findingsIds.length;

  console.log(`[Benchmark] Starting evaluation (Total available: ${findingsIds.length}, Limit: ${limit})...`);

  const results: any[] = [];
  let processedCount = 0;

  for (const id of findingsIds) {
    if (processedCount >= limit) break;

    const finding = metadata[id];
    
    if (finding.benchmark_results?.vuln_status === "success" && !process.env.FORCE_RERUN) {
      console.log(`[${id}] Skipping: already successful.`);
      processedCount++;
      continue;
    }

    const allowedIds = ["008", "020", "041", "054", "070", "077"];
    if (!allowedIds.includes(id)) {
      continue;
    }

    console.log(`\n--- [${id}] ${finding.repo_name} ---`);
    processedCount++;

    try {
      const annotationPath = path.join(DATASET_PATH, finding.annotations);
      let annotationText = "";
      try {
        annotationText = await fs.readFile(annotationPath, "utf-8");
      } catch (e) {
        console.warn(`[${id}] Annotation file not found at ${annotationPath}`);
      }
      
      const targetDir = path.join(process.cwd(), DATASET_PATH, finding.target_directory);
      
      // STEP 1: Accurate Source Code Resolution
      const extractedPath = extractVulnerableFilePath(annotationText);
      let mainContractPath = "";
      let relativeContractPath = finding.main_contract;

      if (extractedPath) {
        const directPath = path.join(targetDir, extractedPath);
        try {
          await fs.access(directPath);
          mainContractPath = directPath;
          relativeContractPath = extractedPath;
        } catch {
          const fileName = path.basename(extractedPath);
          console.log(`[${id}] File not found at ${extractedPath}, searching for ${fileName} recursively...`);
          const foundPath = await findFileRecursively(targetDir, fileName);
          if (foundPath) {
            mainContractPath = foundPath;
            relativeContractPath = path.relative(targetDir, foundPath);
          }
        }
      }

      if (!mainContractPath) {
        mainContractPath = path.join(targetDir, finding.main_contract);
        relativeContractPath = finding.main_contract;
      }
      
      console.log(`[${id}] Using source file: ${relativeContractPath}`);

      let sourceCode = "";
      try {
        sourceCode = await fs.readFile(mainContractPath, "utf-8");
      } catch (e) {
        console.warn(`[${id}] Contract not found at ${mainContractPath}, falling back to metadata.main_contract`);
        try {
            sourceCode = await fs.readFile(path.join(targetDir, finding.main_contract), "utf-8");
        } catch (e2) {
            throw new Error(`Could not find any source code for ${id}`);
        }
      }

      const tempVulnDir = path.join(process.cwd(), "temp_vuln_run", id);
      console.log(`[${id}] Preparing isolated sandbox at ${tempVulnDir}...`);
      await execAsync(`mkdir -p temp_vuln_run && rm -rf ${tempVulnDir} && cp -r ${targetDir} ${tempVulnDir}`);
      


      await execAsync(`rm -f ${tempVulnDir}/.git`);
      // STEP 1.2: Sandbox Initialization
      try {
        const hasPackageJson = await fs.access(path.join(tempVulnDir, "package.json")).then(() => true).catch(() => false);
        if (hasPackageJson) {
          console.log(`[${id}] Found package.json, running npm install...`);
          await execAsync(`npm install --legacy-peer-deps`, { cwd: tempVulnDir, timeout: 120_000 });
        }
      } catch (e: any) {
        console.warn(`[${id}] Warning: Setup failed: ${e.message}`);
      }

      // STEP 1.5: Reference Test Resolution
      let referenceTestCode = "";
      if (finding.test_fix_commands) {
        const match = finding.test_fix_commands.match(/--match-path\s+([^\s]+)/);
        if (match) {
          const testPath = path.join(targetDir, match[1]);
          try {
            referenceTestCode = await fs.readFile(testPath, "utf-8");
            console.log(`[${id}] Found reference test at ${match[1]}`);
          } catch {
            console.warn(`[${id}] Could not read reference test at ${testPath}`);
          }
        }
      }

      // STEP 2: Compute patch diff for specificity guidance
      let patchDiff = "";
      try {
        const patchSourceDir = path.join(process.cwd(), DATASET_PATH, finding.patch);
        patchDiff = await computePatchDiff(patchSourceDir, mainContractPath, targetDir, relativeContractPath);
        if (patchDiff) {
          console.log(`[${id}] Patch diff computed: ${patchDiff.split("\n").length} lines`);
        } else {
          console.log(`[${id}] No patch diff found for main contract`);
        }
      } catch {
        // Patch diff is optional, ignore errors
      }

      const report: VulnerabilityReport = {
        id: id,
        title: `${finding.repo_name} - ${id}`,
        severity: (finding.impact?.toLowerCase() || "medium") as any,
        type: finding.expected_vulnerability || "unknown",
        description: annotationText,
        referenceTestCode: referenceTestCode,
        patchDiff: patchDiff || undefined,
        affectedContract: {
          name: relativeContractPath.split("/").pop()!.replace(".sol", ""),
          sourceCode: sourceCode,
          sourceFilePath: relativeContractPath
        },
        attackVector: "Vulnerability analysis from dataset annotations.",
        customSandboxDir: tempVulnDir 
      };

      console.log(`[${id}] Generating PoC and running on VULNERABLE version...`);
      const resultVuln = await testerAgent.invoke({ report }, { recursionLimit: 100, configurable: { sandboxDir: tempVulnDir } }) as any;
      
      if (process.env.DEBUG_CONTEXT === "true") {
        console.log("\n" + "=".repeat(20) + " GENERATED POC START " + "=".repeat(20));
        try {
          const pocContent = await fs.readFile(path.join(tempVulnDir, "test", "Exploit.t.sol"), "utf-8");
          console.log(pocContent);
        } catch {
          console.log("No PoC file generated.");
        }
        console.log("=".repeat(20) + " GENERATED POC END " + "=".repeat(20) + "\n");
      }
      
      let statusPatch = "not_tested";
      let statusVuln = "not_tested";

      // Evaluate the generated PoC independently
      let pocCodeToTest = "";
      try {
        pocCodeToTest = await fs.readFile(path.join(tempVulnDir, "test", "Exploit.t.sol"), "utf-8");
      } catch (e) {
        console.warn(`[${id}] Could not read Exploit.t.sol from tempVulnDir. Using empty string.`);
      }

      const { runFoundry } = await import("../agents/tester/tools/foundryRunner.js");
      const vulnExec = await runFoundry(pocCodeToTest, tempVulnDir);
      const passedOnVuln = (
        vulnExec.exitCode === 0 &&
        vulnExec.stdout.includes("ok") &&
        !vulnExec.stdout.includes("FAIL") &&
        !vulnExec.combined.includes("No tests found")
      );
      
      statusVuln = passedOnVuln ? "success" : "failed";

      if (statusVuln === "success") {
        console.log(`[${id}] Running PoC on PATCHED version to verify specificity...`);
        
        const tempPatchDir = path.join(process.cwd(), "temp_patch_run", id);
        try {
            await execAsync(`mkdir -p temp_patch_run && rm -rf ${tempPatchDir} && cp -r ${targetDir} ${tempPatchDir}`);
            


            await execAsync(`rm -rf ${tempPatchDir}/.git`);
            try {
              await execAsync(`~/.foundry/bin/forge remappings > remappings.txt`, { cwd: tempPatchDir, timeout: 10000 });
            } catch (e: any) {
              console.warn(`[${id}] Failed to regenerate patch remappings: ${e.message}`);
            }
            
            try {
              const hasPackageJson = await fs.access(path.join(tempPatchDir, "package.json")).then(() => true).catch(() => false);
              if (hasPackageJson) {
                console.log(`[${id}] Found package.json in patch dir, running npm install...`);
                await execAsync(`npm install --legacy-peer-deps`, { cwd: tempPatchDir, timeout: 120_000 });
              }
            } catch (e: any) {
              console.warn(`[${id}] Warning: Patch setup failed: ${e.message}`);
            }

            
            const patchSourceDir = path.join(process.cwd(), DATASET_PATH, finding.patch);
            // Smart patch: match each patched .sol to the right file in tempPatchDir
            await applyPatchSmart(id, tempPatchDir);

            const { runFoundry } = await import("../agents/tester/tools/foundryRunner.js");
            
            let pocCodeToTest = "";
            try {
              pocCodeToTest = await fs.readFile(path.join(tempVulnDir, "test", "Exploit.t.sol"), "utf-8");
            } catch (e) {
              console.warn(`[${id}] Could not read Exploit.t.sol from tempVulnDir. Using empty string.`);
            }

            const patchExec = await runFoundry(pocCodeToTest, tempPatchDir);
            
            // Specific = PoC FAILS on patched version (exploit doesn't work anymore)
            // i.e., exit code != 0, OR stdout doesn't contain "ok", OR test was not found
            const passedOnPatch = (
              patchExec.exitCode === 0 &&
              patchExec.stdout.includes("ok") &&
              !patchExec.stdout.includes("FAIL") &&
              !patchExec.combined.includes("No tests found")
            );
            // statusPatch = "success" means PoC still works on patch (BAD, not specific)
            // statusPatch = "failed" means PoC correctly fails on patch (GOOD, specific)
            statusPatch = passedOnPatch ? "success" : "failed";
            
            if (statusPatch === "failed") {
                console.log(`[${id}] PoC correctly fails on PATCHED version — exploit is SPECIFIC.`);
                await execAsync(`rm -rf ${tempPatchDir}`);
            } else {
                console.log(`[${id}] PoC still passes on PATCHED version — exploit is NOT specific.`);
            }
        } catch (e: any) {
            console.error(`[${id}] Patch run error:`, e.message);
            statusPatch = "error";
        }
      }

      const reproducible = statusVuln === "success";
      const specific = statusVuln === "success" && statusPatch === "failed";

      finding.benchmark_results = {
        vuln_status: statusVuln,
        patch_status: statusPatch,
        reproducibility: reproducible,
        specificity: specific,
        iterations: resultVuln.iterations,
        timestamp: new Date().toISOString(),
      };

      if (statusVuln === "failed") {
          finding.benchmark_results.last_vuln_error = resultVuln.executionLogs[resultVuln.executionLogs.length - 1]?.slice(0, 500);
      }
      
      results.push({
        id,
        reproducible,
        specific,
        iterations: resultVuln.iterations
      });

      await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
      console.log(`[${id}] Result: Reproducible=${reproducible}, Specific=${specific}`);

    } catch (err: any) {
      console.error(`[${id}] Fatal Error:`, err.message);
      finding.benchmark_results = { 
        status: "error", 
        error: err.message,
        timestamp: new Date().toISOString()
      };
      await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
    }
  }
  
  const total = results.length;
  const reproCount = results.filter(r => r.reproducible).length;
  const specCount = results.filter(r => r.specific).length;
  const avgIter = total > 0 ? results.reduce((acc, r) => acc + r.iterations, 0) / total : 0;

  const summary = {
    timestamp: new Date().toISOString(),
    total_processed: total,
    reproducibility_rate: total > 0 ? (reproCount / total) * 100 : 0,
    specificity_rate: reproCount > 0 ? (specCount / reproCount) * 100 : 0,
    overall_ground_truth_rate: total > 0 ? (specCount / total) * 100 : 0,
    average_iterations: avgIter
  };

  console.log("\n" + "=".repeat(50));
  console.log("BENCHMARK SUMMARY");
  console.log("=".repeat(50));
  console.log(`Total Findings:      ${total}`);
  console.log(`Reproducibility:     ${summary.reproducibility_rate.toFixed(1)}% (${reproCount}/${total})`);
  console.log(`Specificity:         ${summary.specificity_rate.toFixed(1)}% (${specCount}/${reproCount})`);
  console.log(`Overall Success:     ${summary.overall_ground_truth_rate.toFixed(1)}% (Verified Ground Truth)`);
  console.log(`Avg Iterations:      ${avgIter.toFixed(2)}`);
  console.log("=".repeat(50));

  await fs.mkdir(path.dirname(SUMMARY_FILE), { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify({ summary, details: results }, null, 2));
  console.log(`Summary saved to ${SUMMARY_FILE}`);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch(console.error);
}

import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Runs a minimal forge build probe to detect missing source files,
 * then creates minimal stub contracts at those exact paths.
 * This unblocks projects that use deep submodule dependencies (e.g. lib/caviar/lib/oracle/...)
 * or node_modules imports that are not present in the sandbox.
 */
export async function createMissingDependencyStubs(sandboxDir: string): Promise<void> {
  // Run forge build on just the project (no test files), capture errors
  let combined = "";
  try {
    const { stdout, stderr } = await execAsync(
      `cd "${sandboxDir}" && forge build --no-cache 2>&1 || true`,
      { timeout: 60_000 }
    );
    combined = stdout + stderr;
  } catch (e: any) {
    combined = e.message || "";
  }

  // Extract all "Source X not found" paths
  const missingPaths: string[] = [];
  const sourceNotFoundRegex = /Source "([^"]+)" not found/g;
  let match: RegExpExecArray | null;
  while ((match = sourceNotFoundRegex.exec(combined)) !== null) {
    const missing = match[1];
    if (!missingPaths.includes(missing)) {
      missingPaths.push(missing);
    }
  }

  if (missingPaths.length === 0) return;

  console.log(`[oracleNode] Detected ${missingPaths.length} missing dependencies, creating stubs...`);

  // Detect Solidity version used in the project (for the stub pragma)
  let pragmaVersion = "^0.8.0";
  try {
    const toml = await fs.readFile(path.join(sandboxDir, "foundry.toml"), "utf-8");
    const vMatch = toml.match(/solc[_-]?version\s*=\s*"([^"]+)"/);
    if (vMatch) pragmaVersion = vMatch[1];
  } catch { /* use default */ }

  for (const missing of missingPaths) {
    // Build the stub path inside the sandbox
    const stubPath = path.join(sandboxDir, missing);
    
    // Skip if file already exists
    try {
      await fs.access(stubPath);
      continue; // already exists
    } catch { /* doesn't exist, create it */ }

    // Skip forge-std — it should always be available
    if (missing.startsWith("forge-std/") || missing.startsWith("lib/forge-std/")) continue;

    try {
      await fs.mkdir(path.dirname(stubPath), { recursive: true });
      
      // Generate a minimal stub that satisfies the import
      const contractName = path.basename(missing, ".sol");
      const stubContent = `// SPDX-License-Identifier: MIT
// AUTO-GENERATED STUB — replaces missing dependency: ${missing}
pragma solidity ${pragmaVersion};

// Minimal stub to satisfy missing import
contract ${contractName} {}
interface I${contractName} {}
`;
      await fs.writeFile(stubPath, stubContent);
      console.log(`  [stub] Created: ${missing}`);
    } catch (e) {
      console.warn(`  [stub] Failed to create ${missing}:`, (e as Error).message);
    }
  }
}

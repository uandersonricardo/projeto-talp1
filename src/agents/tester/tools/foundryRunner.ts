import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, access } from "fs/promises";
import { join } from "path";

const execAsync  = promisify(exec);
const DEFAULT_SANDBOX = process.env.SANDBOX_DIR || "/tmp/poc-sandbox";
const TIMEOUT_MS = 60_000;

export interface FoundryResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
  timedOut: boolean;
}

/**
 * Garante que o sandbox Foundry existe e está inicializado.
 */
async function ensureSandbox(sandboxDir: string) {
  try {
    await access(join(sandboxDir, "foundry.toml"));
  } catch {
    console.log(`[foundryRunner] Sandbox em ${sandboxDir} não encontrado. Inicializando...`);
    // Caminho absoluto para o script de setup (assume execução da raiz do projeto)
    await execAsync("./scripts/setup-sandbox.sh", { env: { ...process.env, SANDBOX_DIR: sandboxDir } });
  }
}

export async function runFoundry(solidityCode: string, sandboxDir: string = DEFAULT_SANDBOX): Promise<FoundryResult> {
  await ensureSandbox(sandboxDir);
  
  // Ensure test directory exists
  const testDir = join(sandboxDir, "test");
  try {
    await access(testDir);
  } catch {
    await execAsync(`mkdir -p "${testDir}"`);
  }
  
  // Escrever o arquivo no sandbox
  const testPath = join(testDir, "Exploit.t.sol");
  await writeFile(testPath, solidityCode, "utf-8");

  try {
    const { stdout, stderr } = await execAsync(
      "forge test --match-contract ExploitTest -vvvv",
      { 
        cwd: sandboxDir, 
        timeout: TIMEOUT_MS, 
        env: { ...process.env, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` } 
      }
    );
    return {
      exitCode: 0,
      stdout,
      stderr,
      combined: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
      timedOut: false,
    };
  } catch (err: any) {
    if (err.killed || err.signal === "SIGTERM") {
      return {
        exitCode: -1, stdout: "", stderr: "Forge timed out",
        combined: `TIMEOUT após ${TIMEOUT_MS / 1000}s`,
        timedOut: true,
      };
    }
    return {
      exitCode: err.code ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      combined: `STDOUT:\n${err.stdout ?? ""}\nSTDERR:\n${err.stderr ?? ""}`,
      timedOut: false,
    };
  }
}

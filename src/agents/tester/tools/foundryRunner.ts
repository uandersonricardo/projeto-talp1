import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, access } from "fs/promises";
import { join } from "path";

const execAsync  = promisify(exec);
const SANDBOX    = "/tmp/poc-sandbox";
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
async function ensureSandbox() {
  try {
    await access(join(SANDBOX, "foundry.toml"));
  } catch {
    console.log("[foundryRunner] Sandbox não encontrado. Inicializando...");
    // Caminho absoluto para o script de setup (assume execução da raiz do projeto)
    await execAsync("./scripts/setup-sandbox.sh");
  }
}

export async function runFoundry(solidityCode: string): Promise<FoundryResult> {
  await ensureSandbox();
  
  // Escrever o arquivo no sandbox
  await writeFile(`${SANDBOX}/test/Exploit.t.sol`, solidityCode, "utf-8");

  try {
    const { stdout, stderr } = await execAsync(
      "forge test --match-contract ExploitTest -vvvv",
      { 
        cwd: SANDBOX, 
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

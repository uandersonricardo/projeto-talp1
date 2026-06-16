import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";

export async function createEmptyFoundryProject(targetDir: string, sourceCode: string, contractName: string) {
  await fs.mkdir(targetDir, { recursive: true });
  execSync("forge init --no-git --force", { 
    cwd: targetDir,
    env: { ...process.env, PATH: `${process.env.PATH}:/home/tales/.foundry/bin` }
  });
  
  // Clean up default files
  await fs.rm(path.join(targetDir, "src", "Counter.sol"), { force: true });
  await fs.rm(path.join(targetDir, "test", "Counter.t.sol"), { force: true });
  await fs.rm(path.join(targetDir, "script", "Counter.s.sol"), { force: true });

  // Write the vulnerable contract source
  const sourcePath = path.join(targetDir, "src", `${contractName}.sol`);
  await fs.writeFile(sourcePath, sourceCode, "utf8");

  return sourcePath;
}

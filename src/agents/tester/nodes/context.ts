import fs from "fs/promises";
import path from "path";

import { PoCState } from "../state.js";
import { logger } from "../../../logger.js";

export async function contextNode(state: PoCState): Promise<Partial<PoCState>> {
  logger.info(`[Tester] contextNode: Preparando ambiente de testes para: ${state.report.title}`);

  if (state.report.customSandboxDir) {
    try {
      const testDir = path.join(state.report.customSandboxDir, "test");
      const testEntries = await fs.readdir(testDir, { withFileTypes: true }).catch(() => []);
      let removed = 0;
      for (const entry of testEntries) {
        if (entry.isFile() && entry.name.endsWith(".t.sol") && entry.name !== "Exploit.t.sol") {
          await fs.unlink(path.join(testDir, entry.name));
          removed++;
        }
      }
      if (removed > 0) {
        logger.info(`[Tester] contextNode: Limpos ${removed} arquivos de teste antigos.`);
      }
    } catch (e) {
      logger.warn(`[Tester] contextNode: falha na limpeza do diretório de testes: ${(e as Error).message}`);
    }
  }

  return {
    templateCode: "",
    pocCode: "",
    infrastructurePhase: false,
  };
}

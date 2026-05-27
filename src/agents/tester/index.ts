import { testerAgent } from "./agent.js";
import { VulnerabilityReport, PoCResult } from "./types.js";
import { logger } from "../../logger.js";

/**
 * Entry point para o Agente Gerador de PoCs.
 * @param report O relatório de vulnerabilidade (mapeado a partir do Finding do Auditor).
 * @returns PoCResult contendo o código do exploit e o status da execução.
 */
export async function runPoCGenerator(report: VulnerabilityReport): Promise<PoCResult> {
  logger.info(`[Tester] runPoCGenerator: iniciando para: ${report.id} — ${report.title}`);

  const finalState = await testerAgent.invoke({ report });

  const result: PoCResult = {
    reportId: report.id,
    status: finalState.status === "running" ? "failed" : finalState.status,
    solidityCode: finalState.pocCode,
    executionLogs: finalState.executionLogs,
    iterations: finalState.iterations,
  };

  logger.info(`[Tester] runPoCGenerator: concluído — status=${result.status}, iterações=${result.iterations}`);
  return result;
}

export type { VulnerabilityReport, PoCResult, Finding, OracleContext } from "./types.js";
export { testerAgent } from "./agent.js";

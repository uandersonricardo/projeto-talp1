import { StateGraph, END, START } from "@langchain/langgraph";

import { PoCStateAnnotation, type PoCState } from "./state.js";
import { generateLocalScaffold } from "./tools/scaffoldGenerator.js";
import type { OracleContext } from "./types.js";
import { createLLM } from "../../config/llm.ts";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import { extractSolidity } from "./utils/extractSolidity.js";
import { runFoundry } from "./tools/foundryRunner.js";
import { analyzeFoundryLog } from "./utils/logAnalyzer.js";
import { logger } from "../../logger.ts";

const MAX_ITERATIONS = 5;

const llm = createLLM();

async function oracleNode(state: PoCState): Promise<Partial<PoCState>> {
  logger.info(`[Tester] oracleNode: gerando scaffold para: ${state.report.title}`);

  const solidityScaffold = generateLocalScaffold(state.report);
  const oracleContext: OracleContext = { solidityScaffold };

  logger.info(`[Tester] oracleNode: scaffold gerado, tamanho: ${solidityScaffold.length} chars`);
  return { oracleContext };
}

async function generatePoCNode(state: PoCState): Promise<Partial<PoCState>> {
  const { report, oracleContext, executionLogs, pocCode, iterations, lastError } = state;
  const isRetry = iterations > 0;

  const userMessage = isRetry
    ? `O seguinte exploit FALHOU no Foundry.

Código anterior:
\`\`\`solidity
${pocCode}
\`\`\`

Output do Forge (última execução):
${executionLogs[executionLogs.length - 1]?.slice(0, 3000) ?? "sem logs"}

Análise do erro: ${lastError ?? "desconhecido"}

Corrija o código. Retorne o arquivo Solidity completo corrigido.`
    : `Relatório de Vulnerabilidade:
- Título: ${report.title}
- Tipo: ${report.type}
- Descrição: ${report.description}
- Vetor de Ataque: ${report.attackVector}
${report.exploitablePaths ? `- Caminhos de Exploração:\n  * ${report.exploitablePaths.join("\n  * ")}` : ""}

Scaffold (complete APENAS test_Exploit):
\`\`\`solidity
${oracleContext!.solidityScaffold}
\`\`\``;

  logger.info(`[Tester] generatePoCNode: iteração ${iterations + 1}, isRetry=${isRetry}`);

  try {
    const response = await llm.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);
    const solidityCode = extractSolidity(response.content as string);
    logger.info(`[Tester] generatePoCNode: Solidity extraído, tamanho: ${solidityCode.length}`);
    return { pocCode: solidityCode, iterations: 1 };
  } catch (err) {
    logger.error(`[Tester] generatePoCNode: falha na geração: ${(err as Error).message}`);
    return { iterations: 1, lastError: `Erro na geração/extração: ${(err as Error).message}` };
  }
}

async function runFoundryNode(state: PoCState): Promise<Partial<PoCState>> {
  logger.info("[Tester] runFoundryNode: executando...");

  const trimmedCode = state.pocCode.trim();
  const isMissingCode = trimmedCode.length === 0;
  const isMissingContract = !trimmedCode.includes("contract ExploitTest");
  const isMissingTest = !trimmedCode.includes("function test_Exploit()");
  const isPlaceholder = trimmedCode.includes("TODO: implementar exploit");
  if (isMissingCode || isMissingContract || isMissingTest || isPlaceholder) {
    const summary =
      state.lastError ??
      (isMissingCode
        ? "Código Solidity ausente. O LLM não retornou o arquivo do exploit."
        : isMissingContract
          ? "Contrato ExploitTest não encontrado no arquivo."
          : isMissingTest
            ? "Função test_Exploit() não encontrada no arquivo."
            : "Exploit não implementado (placeholder TODO ainda presente).");
    const status = state.iterations >= MAX_ITERATIONS ? "failed" : "running";
    return {
      executionLogs: [summary],
      lastError: summary,
      status,
    };
  }

  const result = await runFoundry(state.pocCode);
  const analysis = analyzeFoundryLog(result);
  const noTestsFound = result.combined.includes("No tests found");
  const summary = noTestsFound
    ? "Forge não encontrou nenhum teste. Verifique se o contrato se chama ExploitTest e se existe test_Exploit()."
    : analysis.summary;
  const passed = result.exitCode === 0 && result.stdout.includes("ok") && !noTestsFound;
  const isLastAttempt = state.iterations >= MAX_ITERATIONS;

  const status = passed ? "success" : result.timedOut ? "timeout" : isLastAttempt ? "failed" : "running";

  logger.info(`[Tester] runFoundryNode: resultado Foundry: exitCode=${result.exitCode}, passed=${passed}`);
  if (!passed) {
    logger.info(`[Tester] runFoundryNode: falha detectada: ${analysis.summary}`);
  }

  return {
    executionLogs: [result.combined], // reducer append
    lastError: summary,
    status,
  };
}

async function reflectNode(state: PoCState): Promise<Partial<PoCState>> {
  const lastLog = state.executionLogs[state.executionLogs.length - 1];
  if (!lastLog) {
    return { lastError: "Sem logs disponíveis para análise." };
  }

  const mockResult = {
    exitCode: 1,
    timedOut: lastLog.includes("TIMEOUT"),
    stdout: "",
    stderr: "",
    combined: lastLog,
  };

  const analysis = analyzeFoundryLog(mockResult as any);

  logger.info(`[Tester] reflectNode: categoria: ${analysis.category}`);
  logger.info(`[Tester] reflectNode: resumo: ${analysis.summary}`);

  return {
    lastError: `[${analysis.category.toUpperCase()}] ${analysis.summary}\n\nLinhas relevantes:\n${analysis.relevantLines.join("\n")}`,
  };
}

function routeAfterFoundry(state: PoCState): "reflectNode" | typeof END {
  if (state.status === "success") return END;
  if (state.status === "timeout") return END;
  if (state.iterations >= MAX_ITERATIONS) return END;
  return "reflectNode";
}

const graph = new StateGraph(PoCStateAnnotation)
  .addNode("oracleNode", oracleNode)
  .addNode("generatePoCNode", generatePoCNode)
  .addNode("runFoundryNode", runFoundryNode)
  .addNode("reflectNode", reflectNode)
  .addEdge(START, "oracleNode")
  .addEdge("oracleNode", "generatePoCNode")
  .addEdge("generatePoCNode", "runFoundryNode")
  .addConditionalEdges("runFoundryNode", routeAfterFoundry, {
    reflectNode: "reflectNode",
    [END]: END,
  })
  .addEdge("reflectNode", "generatePoCNode");

export const testerAgent = graph.compile();

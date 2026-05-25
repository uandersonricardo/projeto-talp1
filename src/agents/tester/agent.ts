import "dotenv/config";
import { StateGraph, END, START } from "@langchain/langgraph";
import { PoCStateAnnotation, PoCState } from "./state.js";
import { generateLocalScaffold } from "./tools/scaffoldGenerator.js";
import { OracleContext } from "./types.js";
import { ChatOpenRouter } from "@langchain/openrouter";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import { extractSolidity } from "./utils/extractSolidity.js";
import { runFoundry } from "./tools/foundryRunner.js";
import { analyzeFoundryLog } from "./utils/logAnalyzer.js";

const MAX_ITERATIONS = 5;

const llm = new ChatOpenRouter({
  model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
  temperature: 0.2,
  apiKey: process.env.OPENROUTER_API_KEY,
});

async function oracleNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[oracleNode] gerando scaffold para:", state.report.title);

  const solidityScaffold = generateLocalScaffold(state.report);
  const oracleContext: OracleContext = { solidityScaffold };

  console.log("[oracleNode] scaffold gerado, tamanho:", solidityScaffold.length, "chars");
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

  console.log(`[testerAgent] generatePoCNode iteração ${iterations + 1}, isRetry=${isRetry}`);

  try {
    const response = await llm.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);
    const solidityCode = extractSolidity(response.content as string);
    console.log("[testerAgent] Solidity extraído, tamanho:", solidityCode.length);
    return { pocCode: solidityCode, iterations: 1 };
  } catch (err) {
    console.error("[testerAgent] falha na geração:", (err as Error).message);
    return { iterations: 1, lastError: `Erro na geração/extração: ${(err as Error).message}` };
  }
}

async function runFoundryNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[testerAgent] Executando runFoundryNode...");
  const result   = await runFoundry(state.pocCode);
  const analysis = analyzeFoundryLog(result);
  const passed   = result.exitCode === 0 && result.stdout.includes("ok");

  console.log(`[testerAgent] Resultado Foundry: exitCode=${result.exitCode}, passed=${passed}`);
  if (!passed) {
    console.log(`[testerAgent] Falha detectada: ${analysis.summary}`);
  }

  return {
    executionLogs: [result.combined],   // reducer append
    lastError: analysis.summary,
    status: passed          ? "success"
          : result.timedOut ? "timeout"
          : "running",
  };
}

async function reflectNode(state: PoCState): Promise<Partial<PoCState>> {
  const lastLog = state.executionLogs[state.executionLogs.length - 1];
  if (!lastLog) {
    return { lastError: "Sem logs disponíveis para análise." };
  }

  const mockResult = {
    exitCode: 1, timedOut: lastLog.includes("TIMEOUT"),
    stdout: "", stderr: "", combined: lastLog,
  };

  const analysis = analyzeFoundryLog(mockResult as any);

  console.log(`[reflectNode] categoria: ${analysis.category}`);
  console.log(`[reflectNode] resumo: ${analysis.summary}`);

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

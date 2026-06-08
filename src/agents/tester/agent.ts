import "dotenv/config";
import { StateGraph, END, START } from "@langchain/langgraph";
import { PoCStateAnnotation, PoCState } from "./state.js";
import { generateLocalScaffold } from "./tools/scaffoldGenerator.js";
import { OracleContext } from "./types.js";
import { createLLM } from "../../config/llm.ts";
import { 
  SYSTEM_PROMPT, 
  ANALYZE_VULNERABILITY_PROMPT, 
  POC_INITIAL_PROMPT, 
  POC_COMPILE_FIX_PROMPT, 
  POC_TEST_FIX_PROMPT 
} from "./prompts/system.js";
import { extractSolidity } from "./utils/extractSolidity.js";
import { runFoundry } from "./tools/foundryRunner.js";
import { analyzeFoundryLog } from "./utils/logAnalyzer.js";
import { extractConstructor } from "./utils/parserUtils.js";
import { analyzeSolidityFile } from "../auditor/tools/solidity-analyzer-tool.js";

const MAX_ITERATIONS = 10;

const llm = createLLM();

async function oracleNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[oracleNode] gerando scaffold para:", state.report.title);

  const solidityScaffold = generateLocalScaffold(state.report);
  
  // Extrair info do constructor para ajudar o LLM no setUp
  const constructorInfo = extractConstructor(state.report.affectedContract.sourceCode, state.report.affectedContract.name);
  
  // STEP 3: Automated API Discovery
  console.log("[oracleNode] analisando API do contrato e helpers de teste...");
  const targetContractAPI = await analyzeSolidityFile(state.report.affectedContract.sourceCode, "short");
  
  let referenceTestHelpers = "";
  if (state.report.referenceTestCode) {
    referenceTestHelpers = await analyzeSolidityFile(state.report.referenceTestCode, "short");
  }

  const oracleContext: OracleContext = { 
    solidityScaffold,
    constructorInfo: constructorInfo?.parameters,
    targetContractAPI,
    referenceTestHelpers
  };

  console.log("[oracleNode] scaffold gerado, context built.");
  return { oracleContext };
}

/**
 * NEW: Multi-Pass Node 1 - Analysis
 */
async function analyzeVulnerabilityNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[testerAgent] analyzeVulnerabilityNode: analyzing bug...");

  const userMessage = `Vulnerability Report:
- Title: ${state.report.title}
- Type: ${state.report.type}
- Description: ${state.report.description}

### Target Contract Source Code (${state.report.affectedContract.name}):
\`\`\`solidity
${state.report.affectedContract.sourceCode}
\`\`\`

### Target Contract API:
${state.oracleContext!.targetContractAPI}

${state.oracleContext!.referenceTestHelpers ? `### Environment Helpers:
${state.oracleContext!.referenceTestHelpers}` : ""}
`;

  const response = await llm.invoke([
    { role: "system", content: ANALYZE_VULNERABILITY_PROMPT },
    { role: "user", content: userMessage },
  ]);

  return { vulnerabilityAnalysis: response.content as string };
}

/**
 * Multi-Pass Node 2 - Code Generation (Initial & Fixes)
 */
async function generatePoCNode(state: PoCState): Promise<Partial<PoCState>> {
  const { report, oracleContext, executionLogs, pocCode, iterations, lastError, vulnerabilityAnalysis } = state;
  const isRetry = iterations > 0;

  let currentSystemPrompt = SYSTEM_PROMPT;
  let userMessage = "";

  if (!isRetry) {
    // PASS 2: INITIAL GENERATION
    currentSystemPrompt = POC_INITIAL_PROMPT;
    userMessage = `Vulnerability Analysis Plan:
${vulnerabilityAnalysis}

### Contract Source:
\`\`\`solidity
${report.affectedContract.sourceCode}
\`\`\`

### API Reference:
${oracleContext!.targetContractAPI}

${oracleContext!.referenceTestHelpers ? `### Test Helpers:
${oracleContext!.referenceTestHelpers}` : ""}

### Scaffold:
\`\`\`solidity
${oracleContext!.solidityScaffold}
\`\`\`
`;
  } else {
    // PASS 3+: FIXING ERRORS (BRANCHING)
    const isCompilerError = lastError?.includes("[COMPILER_ERROR]");
    currentSystemPrompt = isCompilerError ? POC_COMPILE_FIX_PROMPT : POC_TEST_FIX_PROMPT;

    userMessage = `The previous PoC failed.
    
Error Category: ${isCompilerError ? "Compilation Failure" : "Execution/Logic Failure"}
Forge Output:
${executionLogs[executionLogs.length - 1]?.slice(0, 3000) ?? "sem logs"}

Previous Code:
\`\`\`solidity
${pocCode}
\`\`\`

Analysis of the bug:
${vulnerabilityAnalysis}

Fix the code. Return the entire file.`;
  }

  console.log(`[testerAgent] generatePoCNode iteração ${iterations + 1}, isRetry=${isRetry}, mode=${isRetry ? (lastError?.includes("[COMPILER_ERROR]") ? "FIX_COMPILE" : "FIX_LOGIC") : "INITIAL"}`);

  // DEBUG: Output context before sending to LLM
  if (process.env.DEBUG_CONTEXT === "true") {
    console.log("\n" + "=".repeat(20) + " LLM CONTEXT START " + "=".repeat(20));
    console.log("System Prompt:", currentSystemPrompt);
    console.log("User Message:", userMessage);
    console.log("=".repeat(20) + " LLM CONTEXT END " + "=".repeat(20) + "\n");
  }

  try {
    const response = await llm.invoke([
      { role: "system", content: currentSystemPrompt },
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

  const trimmedCode = state.pocCode.trim();
  const isMissingCode = trimmedCode.length === 0;
  const isMissingContract = !trimmedCode.includes("contract ExploitTest");
  const isMissingTest = !trimmedCode.includes("function test_Exploit()");
  const isPlaceholder = trimmedCode.includes("TODO: implementar exploit");
  const isLazyTest = (
    trimmedCode.includes("assertTrue(true") || 
    trimmedCode.includes("assert(true") || 
    trimmedCode.includes("assert(1 == 1")
  ) && !trimmedCode.includes("assertEq") && !trimmedCode.includes("assertGt") && !trimmedCode.includes("assertLe") && !trimmedCode.includes("assertGe") && !trimmedCode.includes("assertNotEq");

  if (isMissingCode || isMissingContract || isMissingTest || isPlaceholder || isLazyTest) {
    const summary = state.lastError ?? (isMissingCode
      ? "Código Solidity ausente. O LLM não retornou o arquivo do exploit."
      : isMissingContract
        ? "Contrato ExploitTest não encontrado no arquivo."
        : isMissingTest
          ? "Função test_Exploit() não encontrada no arquivo."
          : isPlaceholder
            ? "Exploit não implementado (placeholder TODO ainda presente)."
            : "Exploit muito fraco (assertTrue(true)). Você deve provar a vulnerabilidade com uma asserção real (ex: assertEq, assertGt)."
    );
    const status = state.iterations >= MAX_ITERATIONS ? "failed" : "running";
    return {
      executionLogs: [summary],
      lastError: summary,
      status,
    };
  }

  const result   = await runFoundry(state.pocCode, state.report.customSandboxDir);
  const analysis = analyzeFoundryLog(result);
  const noTestsFound = result.combined.includes("No tests found");
  const summary = noTestsFound
    ? "Forge não encontrou nenhum teste. Verifique se o contrato se chama ExploitTest e se existe test_Exploit()."
    : analysis.summary;
  const passed   = result.exitCode === 0 && result.stdout.includes("ok") && !noTestsFound;
  const isLastAttempt = state.iterations >= MAX_ITERATIONS;

  const status = passed
    ? "success"
    : result.timedOut
      ? "timeout"
      : isLastAttempt
        ? "failed"
        : "running";

  console.log(`[testerAgent] Resultado Foundry: exitCode=${result.exitCode}, passed=${passed}`);
  if (!passed) {
    console.log(`[testerAgent] Falha detectada: ${analysis.summary}`);
  }

  return {
    executionLogs: [result.combined],   // reducer append
    lastError: passed ? null : `[${analysis.category.toUpperCase()}] ${summary}`,
    status,
  };
}

async function reflectNode(state: PoCState): Promise<Partial<PoCState>> {
  // Now reflectNode is simpler as we moved the logic to specialized prompts in generatePoCNode
  // But we still use it to log the reflection
  console.log(`[reflectNode] reflecting on error: ${state.lastError}`);
  return {};
}

function routeAfterFoundry(state: PoCState): "reflectNode" | typeof END {
  if (state.status === "success") return END;
  if (state.status === "timeout") return END;
  if (state.iterations >= MAX_ITERATIONS) return END;
  return "reflectNode";
}

const graph = new StateGraph(PoCStateAnnotation)
  .addNode("oracleNode", oracleNode)
  .addNode("analyzeVulnerabilityNode", analyzeVulnerabilityNode)
  .addNode("generatePoCNode", generatePoCNode)
  .addNode("runFoundryNode", runFoundryNode)
  .addNode("reflectNode", reflectNode)
  .addEdge(START, "oracleNode")
  .addEdge("oracleNode", "analyzeVulnerabilityNode")
  .addEdge("analyzeVulnerabilityNode", "generatePoCNode")
  .addEdge("generatePoCNode", "runFoundryNode")
  .addConditionalEdges("runFoundryNode", routeAfterFoundry, {
    reflectNode: "reflectNode",
    [END]: END,
  })
  .addEdge("reflectNode", "generatePoCNode");

export const testerAgent = graph.compile();

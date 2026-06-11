import "dotenv/config";
import fs from "fs/promises";
import path from "path";

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
  POC_TEST_FIX_PROMPT,
  POC_MINIMAL_INTERFACE_PROMPT
} from "./prompts/system.js";
import { extractSolidity } from "./utils/extractSolidity.js";
import { runFoundry } from "./tools/foundryRunner.js";
import { analyzeFoundryLog } from "./utils/logAnalyzer.js";
import { extractProjectContext } from "./utils/projectContextExtractor.js";
import { createMissingDependencyStubs } from "./utils/dependencyStubber.js";
import { analyzeSolidityFile } from "../auditor/tools/solidity-analyzer-tool.js";
import { extractConstructor } from "./utils/parserUtils.js";

const MAX_ITERATIONS = 6;

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

  let projectRemappings = "";
  let projectTestImports = "";
  let projectTestFilePath: string | null = null;
  if (state.report.customSandboxDir) {
    console.log("[oracleNode] extracting project context (remappings, test imports)...");
    try {
      const projectCtx = await extractProjectContext(state.report.customSandboxDir);
      projectRemappings = projectCtx.remappings;
      projectTestImports = projectCtx.existingTestImports;
      projectTestFilePath = projectCtx.existingTestFilePath;
      if (projectRemappings) console.log("[oracleNode] found remappings:", projectRemappings.split("\n").length, "entries");
      if (projectTestImports) console.log("[oracleNode] found existing test imports from:", projectTestFilePath);
    } catch (e) {
      console.warn("[oracleNode] could not extract project context:", (e as Error).message);
    }

    // STEP 5: Remove existing project test files from sandbox test/ directory.
    // Forge compiles ALL .t.sol files even when only running Exploit.t.sol.
    // Existing tests often import missing deps (@prb/test, lib/caviar, etc.)
    // causing compilation failures even when our Exploit.t.sol is clean.
    // We already extracted the import context we needed — now clean up.
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
      if (removed > 0) console.log(`[oracleNode] Removed ${removed} existing test files from sandbox (avoids missing dep conflicts)`);
    } catch (e) {
      console.warn("[oracleNode] test cleanup failed (non-fatal):", (e as Error).message);
    }

    // STEP 6: Pre-flight dependency stub creation
    // After removing conflicting test files, create stubs for any remaining missing deps
    try {
      await createMissingDependencyStubs(state.report.customSandboxDir);
    } catch (e) {
      console.warn("[oracleNode] stub creation failed (non-fatal):", (e as Error).message);
    }
  }


  const oracleContext: OracleContext = { 
    solidityScaffold,
    constructorInfo: constructorInfo?.parameters,
    targetContractAPI,
    referenceTestHelpers,
    projectRemappings,
    projectTestImports,
    projectTestFilePath,
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

${state.report.patchDiff ? `### PATCH DIFF (what the fix changes — use this to write a SPECIFIC assertion):
The following diff shows exactly what changed between the vulnerable and patched version.
Your generated PoC MUST produce an assertion that:
- PASSES on the vulnerable version (bug exists)
- FAILS on the patched version (bug is fixed)

\`\`\`diff
${state.report.patchDiff}
\`\`\`` : ""}
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

${oracleContext!.projectRemappings ? `### Project Remappings (use these for import paths):
\`\`\`
${oracleContext!.projectRemappings}
\`\`\`` : ""}

${oracleContext!.projectTestImports ? `### Import Pattern from Existing Test (${oracleContext!.projectTestFilePath}):
\`\`\`solidity
${oracleContext!.projectTestImports}
\`\`\`` : ""}

### Scaffold:
\`\`\`solidity
${oracleContext!.solidityScaffold}
\`\`\`
`;
  } else {
    // PASS 3+: FIXING ERRORS (BRANCHING)
    const isCompilerError = lastError?.includes("[COMPILER_ERROR]") || lastError?.includes("[INVALID_CODE]");
    const useMinimalStrategy = state.compileFailures >= 3;
    
    if (useMinimalStrategy && isCompilerError) {
      // ESCAPE HATCH: After 3 compile failures, switch to zero-import minimal interface strategy
      currentSystemPrompt = POC_MINIMAL_INTERFACE_PROMPT;
      console.log("[testerAgent] Switching to MINIMAL_INTERFACE strategy after", state.compileFailures, "compile failures");
    } else {
      currentSystemPrompt = isCompilerError ? POC_COMPILE_FIX_PROMPT : POC_TEST_FIX_PROMPT;
    }

    userMessage = `The previous PoC failed.
    
Error Category: ${isCompilerError ? "Compilation Failure" : "Execution/Logic Failure"}
Error Details:
${lastError ?? ""}

Forge Output (last attempt):
${executionLogs[executionLogs.length - 1]?.slice(0, 3500) ?? "sem logs"}

Previous Code:
\`\`\`solidity
${pocCode}
\`\`\`

Analysis of the bug:
${vulnerabilityAnalysis}

${!useMinimalStrategy && oracleContext!.projectRemappings ? `Project Remappings (use these for import paths):
\`\`\`
${oracleContext!.projectRemappings}
\`\`\`` : ""}

${!useMinimalStrategy && oracleContext!.projectTestImports ? `Import Pattern from Existing Test (${oracleContext!.projectTestFilePath}):
\`\`\`solidity
${oracleContext!.projectTestImports}
\`\`\`` : ""}

Fix the code. Return the entire file.`;
  }

  console.log(`[testerAgent] generatePoCNode iteração ${iterations + 1}, isRetry=${isRetry}, compileFailures=${state.compileFailures}, mode=${isRetry ? (lastError?.includes("COMPILER_ERROR") || lastError?.includes("INVALID_CODE") ? (state.compileFailures >= 3 ? "MINIMAL_INTERFACE" : "FIX_COMPILE") : "FIX_LOGIC") : "INITIAL"}`);

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
  const hasStrongAssertion = (
    trimmedCode.includes("assertEq") || 
    trimmedCode.includes("assertGt") ||
    trimmedCode.includes("assertLt") ||
    trimmedCode.includes("assertLe") ||
    trimmedCode.includes("assertGe") ||
    trimmedCode.includes("assertNotEq") ||
    trimmedCode.includes("assertApproxEq")
  );
  const isLazyTest = (
    trimmedCode.includes("assertTrue(true") || 
    trimmedCode.includes("assert(true") || 
    trimmedCode.includes("assert(1 == 1")
  ) && !hasStrongAssertion;

  if (isMissingCode || isMissingContract || isMissingTest || isPlaceholder || isLazyTest) {
    const summary = (isMissingCode
      ? "[INVALID_CODE] No Solidity code returned. The LLM must output a complete solidity code block."
      : isMissingContract
        ? "[INVALID_CODE] No 'contract ExploitTest' found. The test contract MUST be named ExploitTest."
        : isMissingTest
          ? "[INVALID_CODE] No 'function test_Exploit()' found. The test function MUST be named test_Exploit()."
          : isPlaceholder
            ? "[INVALID_CODE] Exploit has TODO placeholder. You must implement the actual exploit logic."
            : "[WEAK_ASSERTION] Only assertTrue(true) found — this never proves the vulnerability. Add a meaningful assertion like assertGt(attacker.balance, initialBalance) or assertEq(owner, attacker)."
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

  // Build lastError: include relevant error lines prominently so the LLM sees them at the top of the fix prompt
  let lastErrorMsg: string | null = null;
  if (!passed) {
    const relevantLinesText = analysis.relevantLines.length > 0
      ? `\nKey error lines:\n${analysis.relevantLines.slice(0, 15).join("\n")}`
      : "";
    lastErrorMsg = `${analysis.summary}${relevantLinesText}`;
  }

  const isCompileError = analysis.category === "compiler_error";
  
  return {
    executionLogs: [result.combined],   // reducer append
    lastError: lastErrorMsg,
    status,
    compileFailures: isCompileError && !passed ? 1 : 0, // additive reducer counts each compile failure
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

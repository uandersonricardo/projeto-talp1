import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

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
import { generateInfrastructureNode, generateExploitNode } from "./nodes.js";
import { oracleNode } from "./nodes/oracle.js";
import { analyzeVulnerabilityNode } from "./nodes/analyzeVulnerability.js";
import { generateInfrastructureNode, generateExploitNode } from "./nodes.js";

const MAX_INFRA_ITERATIONS = 30;
const MAX_EXPLOIT_ITERATIONS = 30;

// LLM Routing: Smart model for strategy/logic, Fast model for syntax/compilation
const smartLlm = createLLM(undefined, "google/gemini-3-flash-preview");
const fastLlm = createLLM(undefined, "google/gemini-3.1-flash-lite");
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

  console.log("[testerAgent] analyzeVulnerabilityNode: analyzing bug using SMART model...");
  const response = await smartLlm.invoke([
    { role: "system", content: ANALYZE_VULNERABILITY_PROMPT },
    { role: "user", content: userMessage },
  ]);

  return { vulnerabilityAnalysis: response.content as string };
}




async function runFoundryNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[testerAgent] Executando runFoundryNode...");

  const trimmedCode = state.pocCode.trim();
  const isMissingCode = trimmedCode.length === 0;
  const isMissingContract = !trimmedCode.includes("contract ExploitTest");
  const isMissingTest = !trimmedCode.includes("function test_Exploit()");
  const isPlaceholder = trimmedCode.includes("TODO: implementar exploit");
  const isTargetNotDeployed = trimmedCode.includes("// target = new") || 
                              trimmedCode.includes("//Target target = new") || 
                              trimmedCode.includes("// target = address(new") ||
                              trimmedCode.match(/\/\/\s*([a-zA-Z0-9_]+)\s*=\s*(address\()?new\s+[a-zA-Z0-9_]+/);
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

  const isUsingMock = trimmedCode.includes("contract Mock") || trimmedCode.includes("contract Fake");
  const isUsingTryCatch = trimmedCode.includes("try ") && trimmedCode.includes("catch ");

  // Anti-Cheat: Prevent redefining the vulnerable contract inside the test file
  // We only block redefining the EXACT target contract. Legitimate helper/attacker contracts are allowed.
  const targetContractRegex = new RegExp(`contract\\s+${state.report.affectedContract.name}\\b`);
  const hasFakeContracts = targetContractRegex.test(trimmedCode);

  const hasIllegalComments = trimmedCode.split('\n').some(line => {
    const isComment = line.includes('//') || line.includes('/*');
    const isAllowed = line.includes('SPDX-License-Identifier') || line.includes('INJECT_HACK');
    return isComment && !isAllowed;
  });

  if (isMissingCode || isMissingContract || isUsingMock || isUsingTryCatch || hasFakeContracts || isTargetNotDeployed || hasIllegalComments || (!state.infrastructurePhase && (isMissingTest || isPlaceholder || isLazyTest || !hasStrongAssertion))) {
    const summary = (isMissingCode
      ? "[INVALID_CODE] No Solidity code returned. The LLM must output a complete solidity code block."
      : isTargetNotDeployed
        ? "[INVALID_CODE] You left the target contract instantiation commented out. You MUST instantiate the real target contract in setUp() (e.g. `target = new Target()`). Exploiting address(0) is a cheat and will fail."
      : hasIllegalComments
        ? "[INVALID_CODE] You added a comment in the code. This is STRICTLY FORBIDDEN. You must write the actual code instead of comments. Do NOT use '//' or '/*' (except for SPDX and INJECT_HACK)."
      : isUsingMock
        ? "[INVALID_CODE] You created a Mock contract in the test file. This is STRICTLY FORBIDDEN. You MUST import and exploit the real vulnerable contract from the repository."
      : isUsingTryCatch
        ? "[INVALID_CODE] You used a try-catch block in the test. This is STRICTLY FORBIDDEN. If the exploit fails, the test must revert normally. Do not swallow errors."
      : hasFakeContracts
        ? `[INVALID_CODE] You redefined 'contract ${state.report.affectedContract.name}' inside the test file. This is STRICTLY FORBIDDEN. You MUST interact with the real vulnerable contract via 'interface' or 'import'. Do not redefine the vulnerable contract inside the test.`
      : (!state.infrastructurePhase && !hasStrongAssertion)
        ? "[INVALID_CODE] Your test has NO valid assertions (or they are commented out). You MUST include a meaningful assertion like assertGt(attacker.balance, initialBalance) or assertEq(owner, attacker)."
      : isMissingContract
        ? "[INVALID_CODE] No 'contract ExploitTest' found. The test contract MUST be named ExploitTest."
        : isMissingTest
          ? "[INVALID_CODE] No 'function test_Exploit()' found. The test function MUST be named test_Exploit()."
          : isPlaceholder
            ? "[INVALID_CODE] Exploit has TODO placeholder. You must implement the actual exploit logic."
            : "[WEAK_ASSERTION] Only assertTrue(true) found — this never proves the vulnerability. Add a meaningful assertion like assertGt(attacker.balance, initialBalance) or assertEq(owner, attacker)."
    );
    const isLastAttempt = state.infrastructurePhase 
      ? state.infraIterations >= MAX_INFRA_ITERATIONS 
      : state.exploitIterations >= MAX_EXPLOIT_ITERATIONS;
    const status = isLastAttempt ? "failed" : "running";
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
  const isLastAttempt = state.infrastructurePhase 
    ? state.infraIterations >= MAX_INFRA_ITERATIONS 
    : state.exploitIterations >= MAX_EXPLOIT_ITERATIONS;

  let status: "running" | "success" | "failed" | "timeout" = "running";
  if (state.infrastructurePhase) {
    status = result.timedOut ? "timeout" : isLastAttempt && !passed ? "failed" : "running";
  } else {
    status = passed ? "success" : result.timedOut ? "timeout" : isLastAttempt ? "failed" : "running";
  }

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

    // Auto-resolve missing files
    if (lastErrorMsg.includes("File not found")) {
      const match = lastErrorMsg.match(/Source "([^"]+)" not found/);
      if (match) {
        const missingFile = match[1];
        const missingBasename = path.basename(missingFile);
        try {
          if (state.report.customSandboxDir) {
            const findCmd = `find ${state.report.customSandboxDir} -name "${missingBasename}"`;
            const findOutput = execSync(findCmd, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
            if (findOutput.length > 0) {
              const correctPath = path.relative(state.report.customSandboxDir, findOutput[0]);
              lastErrorMsg += `\n\n[TOOL: AUTO-RESOLVE] I found the missing file! The correct import path to use is: "${correctPath}"`;
              console.log(`[testerAgent] Auto-resolved missing file: ${missingBasename} -> ${correctPath}`);
            }
          }
        } catch (e) {
          // Ignore find errors
        }
      }
    }
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

function routeAfterFoundry(state: PoCState): "reflectNode" | "generateExploitNode" | typeof END {
  const isLastAttempt = state.infrastructurePhase 
    ? state.infraIterations >= MAX_INFRA_ITERATIONS 
    : state.exploitIterations >= MAX_EXPLOIT_ITERATIONS;

  if (state.status === "timeout" || (isLastAttempt && state.status === "failed")) {
    return END;
  }
  
  if (!state.infrastructurePhase && state.status === "success") {
    return END;
  }
  
  const isCompileError = state.lastError?.includes("[COMPILER_ERROR]") || state.lastError?.includes("[INVALID_CODE]");
  
  if (state.infrastructurePhase) {
    // We are in the Infra Loop
    if (isCompileError) {
      return "reflectNode"; // Go back to infra fix
    } else {
      // Compiled successfully! Move to Exploit Loop
      return "generateExploitNode";
    }
  } else {
    // We are in the Exploit Loop
    return "reflectNode"; // Go back to exploit fix
  }
}

function routeReflection(state: PoCState): "generateInfrastructureNode" | "generateExploitNode" {
  return state.infrastructurePhase ? "generateInfrastructureNode" : "generateExploitNode";
}

const graph = new StateGraph(PoCStateAnnotation)
  .addNode("oracleNode", oracleNode)
  .addNode("analyzeVulnerabilityNode", analyzeVulnerabilityNode)
  .addNode("generateInfrastructureNode", generateInfrastructureNode)
  .addNode("generateExploitNode", generateExploitNode)
  .addNode("runFoundryNode", runFoundryNode)
  .addNode("reflectNode", reflectNode)
  .addEdge(START, "oracleNode")
  .addEdge("oracleNode", "analyzeVulnerabilityNode")
  .addEdge("analyzeVulnerabilityNode", "generateInfrastructureNode")
  .addEdge("generateInfrastructureNode", "runFoundryNode")
  .addEdge("generateExploitNode", "runFoundryNode")
  .addConditionalEdges("runFoundryNode", routeAfterFoundry, {
    reflectNode: "reflectNode",
    generateExploitNode: "generateExploitNode",
    [END]: END,
  })
  .addConditionalEdges("reflectNode", routeReflection, {
    generateInfrastructureNode: "generateInfrastructureNode",
    generateExploitNode: "generateExploitNode"
  });

export const testerAgent = graph.compile();

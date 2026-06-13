import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { PoCState } from "./state.js";
import { 
  INFRASTRUCTURE_PROMPT, 
  INFRA_FIX_PROMPT, 
  EXPLOIT_INJECTION_PROMPT, 
  EXPLOIT_FIX_PROMPT 
} from "./prompts/system.js";
import { extractSolidity } from "./utils/extractSolidity.js";
import { createLLM } from "../../config/llm.ts";
import { createSearchCodebaseTool, createReadFileTool } from "./tools/codebaseTools.js";
import { AIMessage, ToolMessage } from "@langchain/core/messages";

// Models
const smartLlm = createLLM(undefined, "google/gemini-3-flash-preview");
const fastLlm = createLLM(undefined, "google/gemini-3.1-flash-lite");

// --- INFRASTRUCTURE LOOP ---

export async function generateInfrastructureNode(state: PoCState): Promise<Partial<PoCState>> {
  const { report, oracleContext, executionLogs, iterations, lastError } = state;
  const isRetry = !!lastError;

  let systemPrompt = INFRASTRUCTURE_PROMPT.replace("{TARGET_NAME}", report.affectedContract.name);
  let userMessage = "";

  if (!isRetry) {
    userMessage = `Please generate the Template.
    
### Scaffold:
\`\`\`solidity
${oracleContext!.solidityScaffold}
\`\`\`

### Remappings:
\`\`\`
${oracleContext!.projectRemappings}
\`\`\`

### Import Example:
\`\`\`solidity
${oracleContext!.projectTestImports}
\`\`\``;
  } else {
    systemPrompt = INFRA_FIX_PROMPT.replace("{ERROR_DETAILS}", lastError ?? "");
    userMessage = `The template failed to compile or execute.
    
### Previous Template:
\`\`\`solidity
${state.templateCode}
\`\`\`

Fix the issues and return the updated template. Ensure the target is actually instantiated!`;
  }

  console.log(`[infraNode] Generating template... Retry: ${isRetry}`);

  const sandboxDir = state.report.customSandboxDir || "./sandbox";
  const searchTool = createSearchCodebaseTool(sandboxDir);
  const readTool = createReadFileTool(sandboxDir);
  const tools = [searchTool, readTool];
  const llmWithTools = fastLlm.bindTools(tools);

  const messages: any[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage)
  ];

  let iterationsInLoop = 0;
  const maxIterations = 5;
  let rawContent = "";

  while (iterationsInLoop < maxIterations) {
    console.log(`[infraNode] ReAct loop iteration ${iterationsInLoop + 1}`);
    const response = await llmWithTools.invoke(messages);
    messages.push(response);

    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        let toolResult = "";
        try {
          if (toolCall.name === "searchCodebase") {
            toolResult = await searchTool.invoke(toolCall.args);
          } else if (toolCall.name === "readFile") {
            toolResult = await readTool.invoke(toolCall.args);
          } else {
            toolResult = "Unknown tool.";
          }
        } catch (e: any) {
          toolResult = `Error executing tool: ${e.message}`;
        }
        
        messages.push(new ToolMessage({
          tool_call_id: toolCall.id!,
          name: toolCall.name,
          content: toolResult,
        }));
      }
    } else {
      rawContent = response.content as string;
      break;
    }
    iterationsInLoop++;
  }

  if (!rawContent) {
    const lastMsg = messages[messages.length - 1];
    rawContent = (lastMsg instanceof AIMessage && typeof lastMsg.content === 'string') 
      ? lastMsg.content 
      : `// [LLM_ERROR] Reached max tool iterations without returning final code.`;
  }
  let templateCode = "";
  try {
    templateCode = extractSolidity(rawContent);
  } catch (e: any) {
    // If extraction fails (e.g., safety refusal), return a mock invalid file
    templateCode = `// [LLM_REFUSAL_OR_ERROR] ${e.message}\n// Raw Output: ${rawContent.slice(0, 200)}`;
  }

  return {
    templateCode,
    pocCode: templateCode, // Temporarily treat template as poc to run compiler
    iterations: 1, // Overall
    infraIterations: 1
  };
}

// --- EXPLOIT LOOP ---

export async function generateExploitNode(state: PoCState): Promise<Partial<PoCState>> {
  const { vulnerabilityAnalysis, templateCode, exploitBody, executionLogs, lastError, iterations } = state;
  
  // We transition from infra to exploit loop
  const isRetry = state.infrastructurePhase === false;

  let systemPrompt = EXPLOIT_INJECTION_PROMPT.replace("{TEMPLATE_CODE}", templateCode);
  let userMessage = "";

  if (!isRetry) {
    userMessage = `Please inject the exploit logic based on this analysis:
    
${vulnerabilityAnalysis}`;
  } else {
    systemPrompt = EXPLOIT_FIX_PROMPT
      .replace("{ERROR_DETAILS}", lastError ?? "")
      .replace("{EXPLOIT_BODY}", exploitBody);
    userMessage = `The exploit failed. Please rewrite the body of test_Exploit().`;
  }

  console.log(`[exploitNode] Generating hack... Retry: ${isRetry}`);
  
  const sandboxDir = state.report.customSandboxDir || "./sandbox";
  const searchTool = createSearchCodebaseTool(sandboxDir);
  const readTool = createReadFileTool(sandboxDir);
  const tools = [searchTool, readTool];
  const llmWithTools = smartLlm.bindTools(tools);

  const messages: any[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage)
  ];

  let iterationsInLoop = 0;
  const maxIterations = 5;
  let rawContent = "";

  while (iterationsInLoop < maxIterations) {
    console.log(`[exploitNode] ReAct loop iteration ${iterationsInLoop + 1}`);
    const response = await llmWithTools.invoke(messages);
    messages.push(response);

    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        let toolResult = "";
        try {
          if (toolCall.name === "searchCodebase") {
            toolResult = await searchTool.invoke(toolCall.args);
          } else if (toolCall.name === "readFile") {
            toolResult = await readTool.invoke(toolCall.args);
          } else {
            toolResult = "Unknown tool.";
          }
        } catch (e: any) {
          toolResult = `Error executing tool: ${e.message}`;
        }
        
        messages.push(new ToolMessage({
          tool_call_id: toolCall.id!,
          name: toolCall.name,
          content: toolResult,
        }));
      }
    } else {
      rawContent = response.content as string;
      break;
    }
    iterationsInLoop++;
  }

  if (!rawContent) {
    const lastMsg = messages[messages.length - 1];
    rawContent = (lastMsg instanceof AIMessage && typeof lastMsg.content === 'string') 
      ? lastMsg.content 
      : `// [LLM_ERROR] Reached max tool iterations without returning final code.`;
  }

  // --- GUARDRAIL: Catch comments immediately before Foundry ---
  // The system prompts forbid // and /*. If the LLM still generates them (except SPDX/INJECT),
  // we catch it here to save a slow Foundry roundtrip.
  let newExploitBody = "";
  try {
    newExploitBody = extractSolidity(rawContent);
    const codeLines = newExploitBody.split('\n');
    const hasIllegalComments = codeLines.some(line => {
      const t = line.trim();
      if (t.startsWith("// SPDX-License-Identifier:") || t.includes("// INJECT_HACK")) return false;
      return t.includes("//") || t.includes("/*");
    });
    
    if (hasIllegalComments) {
      throw new Error("[GUARDRAIL_ERROR] You added a comment in the code. This is STRICTLY FORBIDDEN. Write the actual code instead of comments. Do NOT use '//' or '/*' (except for SPDX).");
    }
  } catch (e: any) {
    // Return the generated code + error so the reflection loop catches it
    return {
      pocCode: rawContent, // pass raw so reflect node can see the mistake
      lastError: e.message,
      exploitIterations: state.exploitIterations + 1
    };
  }
  
  // The Exploit LLM now outputs the FULL file
  const pocCode = newExploitBody;

  return {
    exploitBody: newExploitBody,
    pocCode: pocCode, // This is the final runnable file
    infrastructurePhase: false, // Transition permanently to exploit loop
    iterations: state.iterations + 1,
    exploitIterations: state.exploitIterations + 1
  };
}

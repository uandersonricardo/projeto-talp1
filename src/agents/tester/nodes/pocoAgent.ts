import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { PoCState } from "../state.js";
import { pocoTools } from "../tools.js";
import { createLLM } from "../../../config/llm.js";

const MAX_STEPS = 30; // Max tool calls threshold
const MAX_COST_USD = 3.0; // Max cost threshold

// Initialize the model and bind tools
const model = createLLM().bindTools(pocoTools);

const POCO_SYSTEM_PROMPT = `You are an expert smart contract security testing specialist. Generate executable Proof-of-Concept (PoC) exploits demonstrating vulnerabilities using Foundry.

## PoC Explainability
Write exploits as executable demonstrations that clearly prove the vulnerability. Include detailed comments documenting each attack step, the vulnerability being exploited, and why the exploit succeeds. The PoC must be self-explanatory to security auditors.

## Vulnerability Analysis
Parse the vulnerability description (annotation) and analyze the vulnerability type, affected code sections, and potential impact. Analyze the contract logic to understand the root cause before developing exploits.

## Testing Framework Guidelines
Use Foundry exclusively for testing. Implement proper \`setUp()\` functions with realistic contract states: i.e. initializing contracts with typical production values (reasonable token balances, realistic timestamps, standard protocol roles assigned). Utilize Foundry cheatcodes for test control: \`vm.prank()\` for identity switching, \`vm.deal()\` for ETH funding, \`vm.warp()\` for time manipulation, \`vm.expectRevert()\` for failure testing. Structure tests following Foundry conventions with clear test function names prefixed with \`test\`.

## PoC Executability
Ensure all generated code compiles successfully with the specified Solidity version. Verify that tests pass (exploits vulnerability) when the vulnerability exists and fail when properly patched. Use \`smart_contract_compile\` and \`smart_contract_test\` to validate. Resolve all compilation errors, import issues, and version conflicts while preserving original contract logic.

## Iterative Refinement
Debug compilation errors, test failures, and logical inconsistencies systematically using forge output and detailed error messages. For import path errors, use \`grep_search\` to find the correct pattern. Continuously improve until tests compile, execute successfully, and accurately demonstrate the vulnerability. If stuck on the same technical issue for >3 attempts, shift to a minimal working demonstration—proving the vulnerability exists matters more than perfect test coverage or setup complexity.

## Exploit Soundness
Ensure exploits logically reflect the described vulnerability. The attack vector must accurately represent the security issue. Avoid false positives—exploits should fail if the vulnerability is fixed. Verify that the PoC demonstrates the actual impact described in the vulnerability description (annotation).

## Exploit Quality
Keep PoCs minimal and focused. Write only the test file—never modify contracts under test or the original codebase. Reuse existing test infrastructure when available. Create helper contracts or mocks only when the exploit requires them. Avoid assumptions about undocumented contract behavior.`;

function calculateCost(inputTokens: number, outputTokens: number): number {
  // Claude 3.5 Sonnet pricing: $3.00 / 1M input tokens, $15.00 / 1M output tokens
  const inputCost = (inputTokens / 1_000_000) * 3.0;
  const outputCost = (outputTokens / 1_000_000) * 15.0;
  return inputCost + outputCost;
}

export async function pocoAgentNode(state: PoCState): Promise<Partial<PoCState>> {
  let messages = state.messages || [];

  // Check limits
  if (state.toolCallCount >= MAX_STEPS) {
    return {
      status: "failed",
      lastError: `Max tool calls (${MAX_STEPS}) exceeded.`,
    };
  }
  if (state.totalCost >= MAX_COST_USD) {
    return {
      status: "failed",
      lastError: `Max cost ($${MAX_COST_USD}) exceeded. Current cost: $${state.totalCost.toFixed(2)}`,
    };
  }

  // If this is the first iteration, inject system prompt and task prompt
  let initialMessages: any[] = [];
  if (messages.length === 0) {
    const sandboxDir = state.report.customSandboxDir || process.cwd();
    const targetFile = state.report.affectedContract.sourceFilePath || state.report.affectedContract.name;
    const desc = state.report.description || state.report.title;
    
    // Original PoCo prompt
    const taskPrompt = `Create a vulnerability exposing PoC forge test for the vulnerable contract at ${targetFile} using the vulnerability description: ${desc}. Use the write_file tool to save your PoC code to test/Exploit.t.sol. Write ONLY the test file, test ONLY the described vulnerability, and do NOT modify the original contract. Iterate on compilation, test, and logical errors using the smart_contract_compile and smart_contract_test tools. You are done when the test compiles and successfully demonstrates the vulnerability through passing assertions. Note: your execution sandbox is ${sandboxDir}. Ensure all commands target this directory.`;

    initialMessages = [
      new SystemMessage(POCO_SYSTEM_PROMPT),
      new HumanMessage(taskPrompt)
    ];
    messages = initialMessages;
  }

  // Invoke model
  console.log(`[pocoAgent] Invoking model (Steps: ${state.toolCallCount}/${MAX_STEPS}, Cost: $${state.totalCost.toFixed(2)})...`);
  let response;
  let runCost = 0;
  
  let attempts = 0;
  while (attempts < 3) {
    try {
      response = await model.invoke(messages, {
        configurable: { sandboxDir: state.report.customSandboxDir || process.cwd() }
      });
      
      // Calculate costs
      if (response.response_metadata?.tokenUsage) {
        const usage: any = response.response_metadata.tokenUsage;
        runCost = calculateCost(usage.promptTokens || usage.input_tokens || usage.prompt_tokens || 0, usage.completionTokens || usage.output_tokens || usage.completion_tokens || 0);
      }
      break; // Success, exit retry loop
    } catch (err: any) {
      attempts++;
      console.log(`[pocoAgent] API Error (attempt ${attempts}): ${err.message}`);
      if (attempts >= 3) {
        return {
          messages: [new HumanMessage(`Model API Error after 3 attempts: ${err.message}.`)],
          status: "failed",
          lastError: err.message
        };
      }
      // Wait 10 seconds before retrying (in case of strict rate limits)
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  return {
    messages: [...initialMessages, response],
    totalCost: runCost,
    iterations: 1, // Add 1 to total iterations tracking
  };
}

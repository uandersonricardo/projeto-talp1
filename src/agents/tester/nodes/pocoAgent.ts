import { HumanMessage, SystemMessage, AIMessage, trimMessages } from "@langchain/core/messages";
import { PoCState } from "../state.js";
import { pocoTools } from "../tools.js";
import { createLLM } from "../../../config/llm.js";
import { logger, emitStep } from "../../../logger.js";

const MAX_STEPS = 30; // Max tool calls threshold
const MAX_COST_USD = 3.0; // Max cost threshold

// Initialize the model and bind tools
const model = (createLLM() as any).bindTools(pocoTools);

const POCO_SYSTEM_PROMPT = `You are an expert smart contract security testing specialist. Generate executable Proof-of-Concept (PoC) exploits demonstrating vulnerabilities using Foundry.

## PoC Explainability
Write exploits as executable demonstrations that clearly prove the vulnerability. Include detailed comments documenting each attack step, the vulnerability being exploited, and why the exploit succeeds. The PoC must be self-explanatory to security auditors.

## Vulnerability Analysis
Parse the vulnerability description (annotation) and analyze the vulnerability type, affected code sections, and potential impact. Analyze the contract logic to understand the root cause before developing exploits.

## Testing Framework Guidelines
Use Foundry exclusively for testing. Implement proper \`setUp()\` functions with realistic contract states: i.e. initializing contracts with typical production values (reasonable token balances, realistic timestamps, standard protocol roles assigned). Utilize Foundry cheatcodes for test control: \`vm.prank()\` for identity switching, \`vm.deal()\` for ETH funding, \`vm.warp()\` for time manipulation, \`vm.expectRevert()\` for failure testing. Structure tests following Foundry conventions with clear test function names prefixed with \`test\`.

## Setup and Infrastructure
If the project has existing tests, use \`grep_search\` to inspect how they instantiate complex dependencies (factories, oracles, routers) and mimic their \`setUp()\`. If there are NO existing tests available, you MUST build the setup from scratch using standard Foundry cheatcodes. Inspect the base interfaces imported by the target contract (e.g. \`IERC20\`) and create simple local mock contracts or use \`address(this)\` when testing simple functions. DO NOT assume the target contract will accept \`0\` or \`address(this)\` for complex address arrays without checking the source code first.

## Tool Usage and Iterative Refinement
1. **Planning**: Use the \`todo_planner\` tool to maintain a plan (e.g. "1. Analyze constructor 2. Mock token 3. Write exploit"). Update it as you progress.
2. **Writing Code**: Use \`write_file\` to create \`test/Exploit.t.sol\` from scratch.
3. **Editing Code**: Use \`edit_file\` to fix specific bugs instead of rewriting the whole file. This saves tokens and reduces errors.
4. **Execution**: Use \`smart_contract_compile\` and \`smart_contract_test\` to validate. Resolve all compilation errors, import issues, and version conflicts while preserving original contract logic.

## Exploit Soundness
Ensure exploits logically reflect the described vulnerability. The attack vector must accurately represent the security issue. Avoid false positives—exploits should fail if the vulnerability is fixed. Verify that the PoC demonstrates the actual impact described in the vulnerability description (annotation).

## Exploit Quality
Keep PoCs minimal and focused. Write only the test file—never modify contracts under test, foundry.toml, remappings.txt, or the original codebase. The environment is already perfectly configured with all dependencies. Reuse existing test infrastructure when available. Create helper contracts or mocks only when the exploit requires them. Avoid assumptions about undocumented contract behavior.`;

function calculateCost(inputTokens: number, outputTokens: number): number {
  // Claude 3.5 Sonnet pricing: $3.00 / 1M input tokens, $15.00 / 1M output tokens
  const inputCost = (inputTokens / 1_000_000) * 3.0;
  const outputCost = (outputTokens / 1_000_000) * 15.0;
  return inputCost + outputCost;
}

export async function pocoAgentNode(state: PoCState): Promise<Partial<PoCState>> {
  emitStep({ agent: "tester", step: "gen", status: "running" });
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

    initialMessages = [new SystemMessage(POCO_SYSTEM_PROMPT), new HumanMessage(taskPrompt)];
    messages = initialMessages;
  }

  // Invoke model
  logger.info(
    `[Tester] pocoAgent: Invoking model (Steps: ${state.toolCallCount}/${MAX_STEPS}, Cost: $${state.totalCost.toFixed(2)})...`,
  );
  let response: any;
  let runCost = 0;

  let attempts = 0;
  while (attempts < 3) {
    try {
      const trimmedMessages = await trimMessages(messages, {
        maxTokens: 100000,
        strategy: "last",
        tokenCounter: (msgs) =>
          msgs.map((m) => (m.content ? m.content.toString().length / 4 : 0)).reduce((a, b) => a + b, 0),
        includeSystem: true,
        allowPartial: false,
      });

      response = await model.invoke(trimmedMessages, {
        configurable: { sandboxDir: state.report.customSandboxDir || process.cwd() },
      });

      if (process.env.DEBUG_CONTEXT === "true") {
        logger.debug(`[Tester]\n--- Agent Response [Step ${state.toolCallCount}] ---`);
        logger.debug(response.content);
        if (response.tool_calls) {
          logger.debug(`[Tester] Tool Calls: ${JSON.stringify(response.tool_calls, null, 2)}`);
        }
      }

      // Calculate costs
      if (response.response_metadata?.tokenUsage) {
        const usage: any = response.response_metadata.tokenUsage;
        runCost = calculateCost(
          usage.promptTokens || usage.input_tokens || usage.prompt_tokens || 0,
          usage.completionTokens || usage.output_tokens || usage.completion_tokens || 0,
        );
      }
      break; // Success, exit retry loop
    } catch (err: any) {
      attempts++;
      logger.warn(`[Tester] pocoAgent: API Error (attempt ${attempts}): ${err.message}`);
      if (attempts >= 3) {
        return {
          messages: [new HumanMessage(`Model API Error after 3 attempts: ${err.message}.`)],
          status: "failed",
          lastError: err.message,
        };
      }
      // Wait 10 seconds before retrying (in case of strict rate limits)
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  return {
    messages: [response],
    totalCost: runCost,
    toolCallCount: 1, // Reducer is additive
    iterations: 1, // Reducer is additive
  };
}

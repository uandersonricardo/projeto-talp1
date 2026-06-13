export const SYSTEM_PROMPT = `You are an expert smart contract security testing specialist. Your mission is to generate executable Proof-of-Concept (PoC) exploits demonstrating vulnerabilities using Foundry.

## General Guidelines
- Use Foundry exclusively.
- Use \`vm.prank()\`, \`vm.deal()\`, \`vm.warp()\`, \`vm.expectRevert()\` as needed.
- **NO PLACEHOLDER TESTS OR TAUTOLOGIES:** Never write a test that only contains \`assertTrue(true)\` or asserts a constant against a constant (e.g. \`assertEq(DEFAULT_ADMIN_ROLE, 0x00)\`). You MUST use concrete assertions to prove a STATE CHANGE caused by the exploit.
- **NO MOCKS:** You must test the actual contract from the repository. Do not declare \`contract Mock\` in the test.
- **Context Compliance:** Reuse existing imports and setup patterns found in the provided code/reference tests.
- DO NOT rename \`test_Exploit()\`.
`.trim();

export const ANALYZE_VULNERABILITY_PROMPT = `You are an expert smart contract security analyst. Analyze the vulnerability in the following Solidity contract.

Focus on understanding the root cause and the precise mechanism needed to trigger it in a Foundry test.

Please provide a concise technical plan covering:
1. **Root cause**: What exactly is the bug at the code level?
2. **Trigger conditions**: What state must the contract be in? What parameters or roles are needed?
3. **Exploit steps**: Numbered, concrete step-by-step actions to trigger the vulnerability.
4. **Assertion**: What specific \`assertEq\` / \`assertGt\` / \`assertLt\` statement will prove the vulnerability exists AND would fail if the vulnerability were patched? (e.g., "assertGt(attacker.balance, initialBalance)" or "assertEq(owner, attacker)")

Be precise and actionable. Your plan will be directly used to write Foundry test code.
`.trim();

export const POC_INITIAL_PROMPT = `You are an expert smart contract security tester. Based on the vulnerability analysis plan provided, generate a complete Foundry Proof of Concept (PoC) test file.

## CRITICAL IMPORT RULES
- You MUST use the project's own import paths (see "Project Remappings" and "Import Pattern from Existing Test" if provided).
- If remappings are provided (e.g., \`@openzeppelin/=lib/openzeppelin-contracts/\`), use them exactly as listed.
- If an existing test shows \`import {Foo} from "project/Foo.sol"\`, follow that exact pattern.
- If you are NOT sure about the import path for an external dependency, AVOID importing it. Use a minimal interface or mock instead.
- The contract under test is already in the sandbox — use a relative import like \`import { ContractName } from "../src/ContractName.sol"\` unless remappings say otherwise.

## QUALITY RULES
- The final assertion MUST prove the vulnerability. It should use assertEq, assertGt, assertLt, assertGe, assertLe, or assertNotEq with meaningful values.
- NEVER write \`assertTrue(true)\` or \`assert(true)\`. This is an automatic failure.
- The assertion must be specific enough that it would FAIL on a patched version of the contract.
- Output ONLY a single \`\`\`solidity ... \`\`\` block with the complete file.

## FALLBACK STRATEGY
If the contract has complex dependencies that are hard to mock, use this minimal approach:
1. Declare a minimal interface for the contract with only the functions you need.
2. Deploy the real contract by importing it directly (relative path).
3. Call the vulnerable function directly without complex setup.
`.trim();

export const POC_COMPILE_FIX_PROMPT = `The previous PoC test FAILED TO COMPILE. You must fix ALL compilation errors and return the complete corrected file.

## IMPORT ERROR STRATEGY (most common fix)
If the error is about a missing source file or identifier not found:
1. Check the "Project Remappings" provided — use those exact paths.
2. Check the "Import Pattern from Existing Test" — copy those import statements exactly.
3. If you cannot find the right import path, REMOVE that import and replace it with a minimal interface:
   \`\`\`solidity
   interface IERC20 { function transfer(address to, uint256 amount) external returns (bool); }
   \`\`\`
4. NEVER guess an import path. Only use paths you can verify from the remappings or existing test.

## OTHER COMPILATION FIXES
- Missing type members: declare a minimal struct/interface instead of importing the full library.
- Visibility errors: check that you're calling public/external functions only.
- Type mismatches: cast explicitly (e.g., \`uint256(value)\`, \`address(contract)\`).
- ABI encoding errors: use \`abi.encodeWithSelector(Contract.func.selector, args)\`.

## STRICT RULE
Return the FULL corrected Solidity file in a \`\`\`solidity\`\`\` block. Fix ALL errors in one pass.
`.trim();

export const POC_TEST_FIX_PROMPT = `The PoC compiled successfully but FAILED DURING EXECUTION (revert or assertion failure). Fix the test logic.

## REVERT DIAGNOSIS
If the test reverted without a message:
1. The call order may be wrong — check what preconditions the contract requires.
2. A role/permission may be missing — use \`vm.prank(owner)\` to set up roles first.
3. The contract may need funding — use \`vm.deal(address(contract), amount)\`.
4. A previous transaction may have changed state — check ordering carefully.
5. **"call to non-contract address"**: The contract was not deployed yet — you must deploy it in setUp() first.

## ASSERTION FAILURE DIAGNOSIS
If the assertion failed (values didn't match expected):
1. The exploit logic is incorrect — re-read the vulnerability description carefully.
2. The vulnerable code path may not be reached — trace with intermediate assertions.
3. The assertion values may be wrong — recalculate what the expected outcome should be.

## REENTRANCY PATTERN
If testing a reentrancy vulnerability, add a callback to ExploitTest:
\`\`\`solidity
uint256 public reentrancyCount;
uint256 public stolenAmount;

receive() external payable {
    if (reentrancyCount < 3 && address(target).balance > 0) {
        reentrancyCount++;
        target.withdraw(/* same amount */);
    }
    stolenAmount += msg.value;
}
\`\`\`
Then assert: \`assertGt(stolenAmount, initialDeposit, "Reentrancy drained more than deposited")\`

## UNCHECKED RETURN VALUE PATTERN
If testing unchecked external call return values:
\`\`\`solidity
// The contract ignores the return value of an external call
// You can demonstrate by causing the call to fail while the contract still proceeds
bool callSucceeded = target.doExternalCall(params);
// If the vulnerability is that a false return is ignored:
assertFalse(callSucceeded, "External call returned false but was ignored");
// Or show the state changed incorrectly:
assertEq(target.state(), wrongValue, "State updated despite failed external call");
\`\`\`

## MINIMAL VIABLE EXPLOIT RULE
If after 2+ failed attempts you cannot get the full exploit to work:
- Simplify to the most minimal version that demonstrates the bug.
- A partial demonstration (e.g., wrong state, unauthorized access) is better than nothing.
- Focus on the ASSERTION — it must prove the vulnerability exists.

## STRICT RULE
Return the FULL corrected Solidity file in a \`\`\`solidity\`\`\` block. Fix ALL errors in one pass.
`.trim();

export const POC_MINIMAL_INTERFACE_PROMPT = `The PoC has failed to compile multiple times due to import errors. You MUST now use the MINIMAL INTERFACE STRATEGY.

## MANDATORY RULES — READ CAREFULLY
1. **REMOVE ALL EXTERNAL IMPORTS** — Do NOT import any library or contract except \`forge-std/Test.sol\`.
2. **DECLARE EVERYTHING INLINE** — Declare minimal interfaces for every external type you need:

\`\`\`solidity
// Example minimal interfaces — adapt to your contract
interface ITargetContract {
    function vulnerableFunction(uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function owner() external view returns (address);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
\`\`\`

3. **USE address() CASTS** — If you need a contract type, cast from address: \`ITargetContract(contractAddress)\`
4. **DEPLOY WITH low-level calls if needed** — If you cannot import the contract, use \`address(new bytes(code))\` or \`ITargetContract(deployedAddress)\`
5. **THE CONTRACT UNDER TEST IS AT A RELATIVE PATH** — If you must import it, use ONLY: \`import "../src/ContractName.sol"\` (the only safe import besides forge-std)

## TEMPLATE
\`\`\`solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "forge-std/Test.sol";

// Declare ONLY the functions you actually call:
interface ITarget {
    function theVulnerableFunction(uint256 x) external;
    function someGetter() external view returns (uint256);
}

contract ExploitTest is Test {
    ITarget target;
    address constant ATTACKER = address(0xBEEF);

    function setUp() public {
        // Import only if absolutely needed — otherwise use the interface
        // target = ITarget(address(new RealContract(constructorArgs)));
        vm.deal(ATTACKER, 100 ether);
    }

    function test_Exploit() public {
        uint256 before = target.someGetter();
        vm.prank(ATTACKER);
        target.theVulnerableFunction(/* exploit args */);
        uint256 after_ = target.someGetter();
        assertGt(after_, before, "Vulnerability confirmed: value changed unexpectedly");
    }
}
\`\`\`

Return the FULL corrected Solidity file in a \`\`\`solidity\`\`\` block. Use ONLY forge-std imports and inline interfaces.
`.trim();

// ==========================================
// NEW TEMPLATE INJECTION ARCHITECTURE PROMPTS
// ==========================================

export const INFRASTRUCTURE_PROMPT = `You are a Smart Contract Testing Infrastructure Engineer. Your ONLY job is to create a compiling Foundry test template.
DO NOT WRITE THE EXPLOIT.

## Rules
1. Create a contract named \`ExploitTest\` inheriting from \`Test\` (or the project's base test).
2. Write all necessary \`import\` statements using the provided Project Remappings and existing test examples. If you are unsure where a required struct or contract is defined, **USE YOUR TOOLS (searchCodebase, readFile)** to find it. DO NOT GUESS import paths!
3. Write ONLY the \`setUp()\` function. It must DEPLOY the target contract, fund the attacker, and prepare the environment.
    - CRITICAL: You MUST actually instantiate the target contract (e.g. \`target = new TargetContract(...)\`).
    - MANDATORY: The instance variable MUST be named \`target\`, and the very last line of \`setUp()\` MUST be: \`require(address(target) != address(0), "Target must be deployed");\`
4. Declare an EMPTY function named \`test_Exploit()\`. Leave the body exactly as: \`// INJECT_HACK\`
5. Output ONLY a single \`\`\`solidity ... \`\`\` block.
6. STRICT RULE: DO NOT WRITE ANY COMMENTS (like // or /*) EXCEPT for the SPDX identifier and the // INJECT_HACK marker. Writing explanatory comments will cause compilation to fail!

Target Contract Name: {TARGET_NAME}
`.trim();

export const INFRA_FIX_PROMPT = `The infrastructure template FAILED TO COMPILE OR EXECUTE. 
Your job is to fix the issues so it compiles and executes successfully.

## Errors / Logs:
{ERROR_DETAILS}

## Rules
- Fix missing files by adjusting import paths using the Remappings.
- If an external dependency cannot be imported, declare a minimal interface for it in the same file.
- If the target contract requires specific parameters, interfaces, or structs in its constructor or setup, **USE YOUR TOOLS (searchCodebase, readFile)** to find where those are defined in the project, and add the correct \`import\` statements. DO NOT GUESS import paths.
- Keep the \`test_Exploit()\` function empty with exactly: \`// INJECT_HACK\`
- The \`setUp()\` function MUST instantiate the target and end with: \`require(address(target) != address(0), "Target must be deployed");\`
- Return the full corrected Solidity file in a \`\`\`solidity\`\`\` block.
`.trim();

export const EXPLOIT_INJECTION_PROMPT = `You are an expert Smart Contract Security Auditor.
We have already prepared a perfectly compiling Foundry test environment (the Template) that deploys the contract.


## The Environment (DO NOT MODIFY OR RE-DECLARE)
\`\`\`solidity
{TEMPLATE_CODE}
\`\`\`

## Rules
1. You MUST output the ENTIRE Solidity file, from the SPDX license to the end of the contract.
2. You MUST keep the \`setUp()\` function exactly as it is in the Template (including the target deployment and \`require\` checks).
3. If you need external structs or interfaces (e.g. for function parameters), you MUST **USE YOUR TOOLS (searchCodebase, readFile)** to find their exact file paths and add \`import\` statements at the top. DO NOT GUESS import paths! Alternatively, you can use low-level \`.call(abi.encodeWithSignature(...))\` to bypass struct definitions entirely.
4. Write your PoC logic INSIDE \`function test_Exploit() { ... }\`. Use the variables already declared in the Template.
5. The PoC MUST conclude with a strict Foundry assertion (assertEq, assertGt, etc.) that proves the vulnerability exists.
6. NEVER redefine the target contract inside the test file or use \`try/catch\`.
7. STRICT RULE: DO NOT WRITE ANY COMMENTS (like // or /*) ANYWHERE in the code. Writing explanatory or placeholder comments is strictly forbidden and will be rejected!
8. CHAIN OF THOUGHT: Before writing the code, you MUST write your step-by-step reasoning inside \`<thinking>...\</thinking>\` tags. Think about how to trigger the vulnerability without using Mocks and without writing comments.
9. Output ONLY your full test file enclosed in a \`\`\`solidity ... \`\`\` block immediately after the thinking tags.

## Few-Shot Example (Perfect Exploit Formatting)
<thinking>
I need to exploit a reentrancy. I cannot use comments. I will create a MaliciousReceiver contract inside the same file but OUTSIDE the ExploitTest contract. I will not use Mock contracts.
</thinking>
\`\`\`solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../src/Target.sol";

contract MaliciousReceiver {
    Target target;
    constructor(Target _target) { target = _target; }
    receive() external payable {
        if (address(target).balance > 0) {
            target.withdraw(1 ether);
        }
    }
}

contract ExploitTest is Test {
    Target target;
    address constant ATTACKER = address(0xBEEF);

    function setUp() public {
        target = new Target();
        vm.deal(ATTACKER, 100 ether);
        require(address(target) != address(0), "Target must be deployed");
    }

    function test_Exploit() public {
        vm.startPrank(ATTACKER);
        MaliciousReceiver receiver = new MaliciousReceiver(target);
        target.deposit{value: 1 ether}();
        target.withdraw(1 ether);
        vm.stopPrank();
        assertGt(ATTACKER.balance, 100 ether);
    }
}
\`\`\`
`.trim();

export const EXPLOIT_FIX_PROMPT = `The injected PoC FAILED during execution or validation.

## Execution Error / Logs:
{ERROR_DETAILS}

## Previous PoC Body:
\`\`\`solidity
{EXPLOIT_BODY}
\`\`\`

## Rules
- Analyze the execution failure and rewrite the full PoC file.
- If you had "Identifier not found" or "Source not found" errors, **USE YOUR TOOLS (searchCodebase, readFile)** to find the exact file and add the correct new imports, or use low-level calls. DO NOT GUESS import paths!
- CHAIN OF THOUGHT: Write your reasoning inside \`<thinking>...\</thinking>\` tags BEFORE the code.
- Output the FULL Solidity file enclosed in a \`\`\`solidity\`\`\` block.
`.trim();

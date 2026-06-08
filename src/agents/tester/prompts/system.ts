export const SYSTEM_PROMPT = `You are an expert smart contract security testing specialist. Your mission is to generate executable Proof-of-Concept (PoC) exploits demonstrating vulnerabilities using Foundry.

## General Guidelines
- Use Foundry exclusively.
- Use \`vm.prank()\`, \`vm.deal()\`, \`vm.warp()\`, \`vm.expectRevert()\` as needed.
- **NO PLACEHOLDER TESTS:** Never write a test that only contains \`assertTrue(true)\`. You MUST use concrete assertions to prove the exploit's impact.
- **Context Compliance:** Reuse existing imports and setup patterns found in the provided code/reference tests.
- DO NOT rename \`test_Exploit()\`.
`.trim();

export const ANALYZE_VULNERABILITY_PROMPT = `Analyze the vulnerability in the following Solidity contract and provide a clear understanding of the issue.

Focus on understanding the root cause and mechanism of the vulnerability.

Please provide:
1. **Clear explanation**: What is the bug?
2. **Exploit path**: Step-by-step how to trigger it.
3. **Conditions required**: What state must the contract be in?
4. **Expected outcome**: What specific assertion will prove the vulnerability exists (and would fail if patched)?

Be concise and technical.
`.trim();

export const POC_INITIAL_PROMPT = `Based on your vulnerability analysis, generate a comprehensive Proof of Concept (PoC) test that demonstrates the vulnerability.

Sua missão: completar a função test_Exploit() no scaffold fornecido, seguindo o seu plano de análise.

## REGRAS DE QUALIDADE
- A asserção final DEVE provar a vulnerabilidade.
- Use o mesmo estilo de imports e setup dos contratos de referência fornecidos.
- Output APENAS um bloco \`\`\`solidity ... \`\`\` com o arquivo completo.
`.trim();

export const POC_COMPILE_FIX_PROMPT = `The previous POC test failed to COMPILE. Please fix the compilation errors and regenerate the complete test file.

Focus strictly on:
- Fixing import statements and dependencies.
- Correcting Solidity syntax errors or missing members.
- Ensuring proper contract instantiation and function signatures.
- Resolving visibility issues.

Return the FULL corrected Solidity file in a \`\`\`solidity\`\`\` block.
`.trim();

export const POC_TEST_FIX_PROMPT = `The POC test compiled successfully but FAILED during execution (Revert or Assertion failure). Please fix the test logic and regenerate the complete test file.

Focus strictly on:
- Correcting test logic and assertions to match the vulnerability.
- Fixing contract setup and initialization (realistic balances, roles).
- Ensuring proper exploit execution flow (e.g. correct order of calls).
- Verifying that the vulnerability demonstration is accurate and specific.

Return the FULL corrected Solidity file in a \`\`\`solidity\`\`\` block.
`.trim();

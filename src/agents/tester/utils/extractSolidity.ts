export function extractSolidity(llmOutput: string): string {
  // Caso 1: bloco ```solidity ... ``` padrão
  const match = llmOutput.match(/```solidity\s*([\s\S]*?)```/);
  if (match) return match[1].trim();

  // Caso 2: LLM omitiu backticks mas começa com pragma/SPDX
  const trimmed = llmOutput.trim();
  if (trimmed.startsWith("// SPDX") || trimmed.startsWith("pragma")) {
    return trimmed;
  }

  // Caso 3: output inválido — lançar erro descritivo
  throw new Error(
    `LLM output não contém bloco Solidity válido. Preview: "${llmOutput.slice(0, 200)}"`
  );
}

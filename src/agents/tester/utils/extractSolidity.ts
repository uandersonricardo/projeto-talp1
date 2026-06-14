export function extractSolidity(llmOutput: string): string {
  let cleaned = llmOutput.trim();

  // Bulletproof extraction: find SPDX or pragma and slice from there
  const spdxIndex = cleaned.indexOf("// SPDX");
  const pragmaIndex = cleaned.indexOf("pragma solidity");

  let startIndex = -1;
  if (spdxIndex !== -1 && pragmaIndex !== -1) {
    startIndex = Math.min(spdxIndex, pragmaIndex);
  } else if (spdxIndex !== -1) {
    startIndex = spdxIndex;
  } else if (pragmaIndex !== -1) {
    startIndex = pragmaIndex;
  }

  if (startIndex !== -1) {
    // Slice from start index
    cleaned = cleaned.slice(startIndex);
    // Remove trailing backticks
    cleaned = cleaned.replace(/\n?```[a-zA-Z]*\s*$/, "");
    return cleaned.trim();
  }

  throw new Error(
    `LLM output não contém bloco Solidity válido (faltou SPDX ou pragma). Preview: "${cleaned.slice(0, 200)}"`
  );
}

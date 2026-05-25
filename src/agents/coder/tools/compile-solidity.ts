import { tool } from "langchain";
import { z } from "zod";
import solc from "solc";

/**
 * Tool que compila código Solidity usando solc e retorna erros/warnings.
 */
export const compileSolidityTool = tool(
  async (input) => {
    const compilerInput = {
      language: "Solidity",
      sources: {
        [input.filename]: { content: input.sourceCode },
      },
      settings: {
        outputSelection: {
          "*": { "*": ["abi", "evm.bytecode.object"] },
        },
      },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(compilerInput)));

    const errors = (output.errors || [])
      .filter((e: { severity: string }) => e.severity === "error")
      .map((e: { formattedMessage: string }) => e.formattedMessage);

    const warnings = (output.errors || [])
      .filter((e: { severity: string }) => e.severity === "warning")
      .map((e: { formattedMessage: string }) => e.formattedMessage);

    const contracts = output.contracts?.[input.filename] || {};
    const contractNames = Object.keys(contracts);

    return {
      success: errors.length === 0,
      errors,
      warnings,
      contracts: contractNames,
    };
  },
  {
    name: "compilar_solidity",
    description: "Compila código Solidity com solc e retorna erros, warnings e contratos encontrados.",
    schema: z.object({
      sourceCode: z.string().describe("Código-fonte Solidity completo"),
      filename: z.string().default("Contract.sol").describe("Nome do arquivo .sol"),
    }),
  },
);

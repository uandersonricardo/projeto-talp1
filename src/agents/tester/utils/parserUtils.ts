import * as parser from "@solidity-parser/parser";

export interface ConstructorInfo {
  parameters: string;
}

export function extractConstructor(sourceCode: string, contractName: string): ConstructorInfo | null {
  try {
    const ast = parser.parse(sourceCode, { range: true });
    let constructorParams = "";
    let found = false;

    parser.visit(ast, {
      ContractDefinition: (node) => {
        if (node.name === contractName) {
          for (const part of node.subNodes) {
            if (part.type === "FunctionDefinition" && (part as any).isConstructor) {
              found = true;
              if (part.range) {
                  constructorParams = sourceCode.slice(part.range[0], part.range[1]).split("{")[0].trim();
              }
            }
          }
        }
      }
    });

    if (found) {
      return {
        parameters: constructorParams
      };
    }
  } catch (e) {
    // console.warn("Failed to parse Solidity for constructor:", e);
  }
  return null;
}

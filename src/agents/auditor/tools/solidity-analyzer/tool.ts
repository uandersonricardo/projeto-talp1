import { parse } from "@solidity-parser/parser";
import { tool } from "langchain";
import { z } from "zod";

import {
  analyzeFunction,
  buildCommentBlocks,
  type ContractAnalysis,
  extractSolcVersion,
  findCommentFor,
  generateBriefMarkdown,
  generateFullMarkdown,
  paramToString,
  type RenderOptions,
  typeToString,
} from "./utils.ts";

export const analyzeSolidityFile = async (
  soliditySource: string,
  mode: "full" | "short",
  filePath?: string,
  importance?: number,
): Promise<string> => {
  let ast: any;
  try {
    ast = parse(soliditySource, { tolerant: true, loc: true, range: true });
  } catch (e: any) {
    return `# Parse Error\n\nFailed to parse Solidity source: ${e.message as string}`;
  }

  const comments = buildCommentBlocks(soliditySource);
  const imports: string[] = [];
  const contracts: ContractAnalysis[] = [];

  for (const node of ast.children ?? []) {
    if (node.type === "ImportDirective") imports.push(node.path as string);
  }

  for (const node of ast.children ?? []) {
    if (node.type !== "ContractDefinition") continue;

    const contractComment = node.loc ? findCommentFor(node.loc.start.line, comments) : undefined;

    const contract: ContractAnalysis = {
      name: node.name as string,
      kind: (node.kind as string) ?? "contract",
      baseContracts: (node.baseContracts ?? []).map(
        (bc: any) => (bc.baseName?.namePath ?? bc.baseName?.name ?? "?") as string,
      ),
      usingFor: [],
      stateVars: [],
      events: [],
      errors: [],
      modifiers: [],
      functions: [],
      natspec: contractComment?.natspec,
    };

    const stateVarNames = new Set<string>();

    for (const member of node.subNodes ?? []) {
      const memberComment = member.loc ? findCommentFor(member.loc.start.line, comments) : undefined;

      switch (member.type) {
        case "StateVariableDeclaration":
          for (const v of member.variables ?? []) {
            stateVarNames.add(v.name as string);
            contract.stateVars.push({
              name: v.name as string,
              type: typeToString(v.typeName),
              visibility: (v.visibility as string) ?? "internal",
              constant: (v.isDeclaredConst as boolean) ?? false,
              immutable: (v.isImmutable as boolean) ?? false,
              natspec: memberComment?.natspec,
            });
          }
          break;

        case "EventDefinition": {
          const params = (member.parameters ?? []).map((p: any) => {
            const indexed = p.isIndexed ? "indexed " : "";
            const name = p.name ? ` ${p.name as string}` : "";
            return `${indexed}${typeToString(p.typeName)}${name}`;
          });
          contract.events.push({
            name: member.name as string,
            params,
            anonymous: (member.isAnonymous as boolean) ?? false,
            natspec: memberComment?.natspec,
          });
          break;
        }

        case "CustomErrorDefinition":
          contract.errors.push({
            name: member.name as string,
            params: (member.parameters ?? []).map((p: any) => paramToString(p)),
            natspec: memberComment?.natspec,
          });
          break;

        case "ModifierDefinition":
          contract.modifiers.push({
            name: member.name as string,
            params: (member.parameters ?? []).map(paramToString),
            natspec: memberComment?.natspec,
          });
          break;

        case "FunctionDefinition": {
          const { internalCalls, externalCalls, stateReads, stateWrites } = analyzeFunction(member, stateVarNames);
          contract.functions.push({
            name: (member.name as string) ?? "",
            isConstructor: (member.isConstructor as boolean) ?? false,
            isReceive: (member.isReceiveEther as boolean) ?? false,
            isFallback: (member.isFallback as boolean) ?? false,
            visibility: (member.visibility as string) ?? "internal",
            mutability: (member.stateMutability as string) ?? "nonpayable",
            params: (member.parameters ?? []).map(paramToString),
            returns: (member.returnParameters ?? []).map(paramToString),
            modifiers: (member.modifiers ?? []).map((m: any) => m.name as string),
            internalCalls,
            externalCalls,
            stateReads,
            stateWrites,
            natspec: memberComment?.natspec,
          });
          break;
        }

        case "UsingForDeclaration": {
          const forType = member.typeName ? typeToString(member.typeName) : "*";
          if (member.libraryName) {
            contract.usingFor.push(`\`${member.libraryName as string}\` for \`${forType}\``);
          } else {
            const fns = (member.functions ?? [])
              .map((f: any) => (f.typeName?.namePath ?? f.typeName?.name ?? f.path ?? "?") as string)
              .join(", ");
            contract.usingFor.push(`{${fns}} for \`${forType}\``);
          }
          break;
        }
      }
    }

    contracts.push(contract);
  }

  const opts: RenderOptions = {
    filePath,
    importance,
    lineCount: soliditySource.split("\n").length,
    solcVersion: extractSolcVersion(soliditySource),
  };

  return mode === "short"
    ? generateBriefMarkdown(imports, contracts, opts)
    : generateFullMarkdown(imports, contracts, opts);
};

export const solidityAnalyzerTool = tool(async ({ solidityFile, mode }) => analyzeSolidityFile(solidityFile, mode), {
  name: "solidity_analyzer",
  description:
    "Parse a Solidity source file and generate a markdown report. Use mode='short' for a compact summary (meta, external calls, function table). Use mode='full' for the complete report including storage, events, errors, per-function call graph, recursion detection, and state variable touchpoints.",
  schema: z.object({
    solidityFile: z.string().describe("The full Solidity source code to analyze."),
    mode: z
      .enum(["full", "short"])
      .default("full")
      .describe("Report verbosity. 'short' saves tokens; 'full' provides the complete analysis."),
  }),
});

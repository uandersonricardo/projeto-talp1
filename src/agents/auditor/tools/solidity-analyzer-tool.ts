import { parse, visit } from "@solidity-parser/parser";
import { tool } from "langchain";
import { z } from "zod";

const ASSIGNMENT_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", "<<=", ">>=", "**="]);
const BUILTIN_NAMESPACES = new Set(["abi", "block", "msg", "tx", "bytes", "string", "type"]);

interface StateVar {
  name: string;
  type: string;
  visibility: string;
  constant: boolean;
  immutable: boolean;
}

interface EventDef {
  name: string;
  params: string[];
  anonymous: boolean;
}

interface ModifierDef {
  name: string;
  params: string[];
}

interface FunctionDef {
  name: string;
  isConstructor: boolean;
  isReceive: boolean;
  isFallback: boolean;
  visibility: string;
  mutability: string;
  params: string[];
  returns: string[];
  modifiers: string[];
  internalCalls: string[];
  externalCalls: string[];
  stateReads: string[];
  stateWrites: string[];
}

interface ContractAnalysis {
  name: string;
  kind: string;
  baseContracts: string[];
  usingFor: string[];
  stateVars: StateVar[];
  events: EventDef[];
  modifiers: ModifierDef[];
  functions: FunctionDef[];
}

const typeToString = (node: any): string => {
  if (!node) return "unknown";

  switch (node.type) {
    case "ElementaryTypeName":
      return node.name as string;
    case "UserDefinedTypeName":
      return (node.namePath ?? node.name) as string;
    case "ArrayTypeName":
      return `${typeToString(node.baseTypeName)}[${node.length ?? ""}]`;
    case "Mapping":
      return `mapping(${typeToString(node.keyType)} => ${typeToString(node.valueType)})`;
    case "FunctionTypeName":
      return "function";
    default:
      return "unknown";
  }
};

const paramToString = (p: any) => {
  if (!p) return "?";
  const type = typeToString(p.typeName);
  return p.name ? `${type} ${p.name}` : type;
};

const collectLHSRoots = (node: any, targets: Set<string>) => {
  if (!node) return;
  switch (node.type) {
    case "Identifier":
      targets.add(node.name as string);
      break;
    case "MemberAccess":
      collectLHSRoots(node.expression, targets);
      break;
    case "IndexAccess":
      collectLHSRoots(node.base, targets);
      break;
    case "TupleExpression":
      for (const c of node.components ?? []) collectLHSRoots(c, targets);
      break;
  }
};

const analyzeFunction = (funcNode: any, stateVarNames: Set<string>) => {
  const internalCalls = new Set<string>();
  const externalCalls = new Set<string>();
  const writeTargets = new Set<string>();
  const allStateAccesses = new Set<string>();
  const localVars = new Set<string>();

  if (!funcNode.body) {
    return { internalCalls: [], externalCalls: [], stateReads: [], stateWrites: [] };
  }

  // Collect function params and return params as locals so they don't shadow state vars
  for (const p of funcNode.parameters ?? []) {
    if (p?.name) localVars.add(p.name as string);
  }
  for (const p of funcNode.returnParameters ?? []) {
    if (p?.name) localVars.add(p.name as string);
  }

  // Collect local variable declarations
  visit(funcNode.body, {
    VariableDeclarationStatement: (node: any) => {
      for (const v of node.variables ?? []) {
        if (v?.name) localVars.add(v.name as string);
      }
    },
  });

  const effectiveStateVars = new Set([...stateVarNames].filter((v) => !localVars.has(v)));

  // Collect write targets from assignment LHS, unary mutations, and delete
  visit(funcNode.body, {
    ExpressionStatement: (node: any) => {
      const expr = node.expression;
      if (expr?.type === "BinaryOperation" && ASSIGNMENT_OPS.has(expr.operator as string)) {
        collectLHSRoots(expr.left, writeTargets);
      }
      // Handle ++, --, and delete — all work on any lvalue (arr[i]++, delete s.field, etc.)
      if (
        expr?.type === "UnaryOperation" &&
        (expr.operator === "++" || expr.operator === "--" || expr.operator === "delete")
      ) {
        collectLHSRoots(expr.subExpression, writeTargets);
      }
    },
  });

  // Collect calls and state-var identifier accesses
  visit(funcNode.body, {
    FunctionCall: (node: any) => {
      const expr = node.expression;
      if (expr?.type === "Identifier") {
        internalCalls.add(expr.name as string);
      } else if (expr?.type === "MemberAccess") {
        const base = expr.expression;
        if (base?.type === "Identifier" && (base.name === "this" || base.name === "super")) {
          internalCalls.add(expr.memberName as string);
        } else if (base?.type === "Identifier" && BUILTIN_NAMESPACES.has(base.name as string)) {
          // abi.encode, block.xxx, msg.xxx, etc. — not external calls
        } else {
          const baseStr = base?.type === "Identifier" ? (base.name as string) : "<expr>";
          externalCalls.add(`${baseStr}.${expr.memberName as string}`);
        }
      }
    },
    Identifier: (node: any) => {
      if (effectiveStateVars.has(node.name as string)) {
        allStateAccesses.add(node.name as string);
      }
    },
  });

  const stateWrites = [...allStateAccesses].filter((v) => writeTargets.has(v));
  // A var can be in both — e.g. x = x + 1 is both a read and a write.
  const stateReads = [...allStateAccesses];

  return {
    internalCalls: [...internalCalls],
    externalCalls: [...externalCalls],
    stateReads,
    stateWrites,
  };
};

const hasCycle = (start: string, current: string, callMap: Map<string, string[]>, visited: Set<string>) => {
  for (const callee of callMap.get(current) ?? []) {
    if (callee === start) return true;
    if (!visited.has(callee)) {
      visited.add(callee);
      if (hasCycle(start, callee, callMap, visited)) return true;
    }
  }

  return false;
};

const fnLabel = (fn: FunctionDef) => {
  if (fn.isConstructor) return "constructor";
  if (fn.isReceive) return "receive";
  if (fn.isFallback) return "fallback";
  return fn.name;
};

const generateShortMarkdown = (imports: string[], contracts: ContractAnalysis[]) => {
  const lines: string[] = [];
  lines.push("# Solidity Analysis\n");

  if (imports.length > 0) {
    lines.push(`**Imports:** ${imports.map((i) => `\`${i}\``).join(", ")}\n`);
  }

  for (const contract of contracts) {
    const inheritance =
      contract.baseContracts.length > 0 ? ` : ${contract.baseContracts.map((b) => `\`${b}\``).join(", ")}` : "";
    lines.push(`---\n\n## \`${contract.name}\` (${contract.kind})${inheritance}\n`);

    // State variables — one line, name:type
    if (contract.stateVars.length > 0) {
      const vars = contract.stateVars.map((v) => {
        const flags = [v.constant && "constant", v.immutable && "immutable"].filter(Boolean);
        const suffix = flags.length > 0 ? `, ${flags.join(", ")}` : "";
        return `\`${v.name}: ${v.type}\` (${v.visibility}${suffix})`;
      });
      lines.push(`**State:** ${vars.join(", ")}\n`);
    }

    // Modifiers — names only
    if (contract.modifiers.length > 0) {
      const mods = contract.modifiers.map(
        (m) => `\`${m.name}${m.params.length > 0 ? `(${m.params.join(", ")})` : ""}\``,
      );
      lines.push(`**Modifiers:** ${mods.join(", ")}\n`);
    }

    // Events — name + params, one line each
    if (contract.events.length > 0) {
      const evts = contract.events.map((e) => `\`${e.name}(${e.params.join(", ")})\``);
      lines.push(`**Events:** ${evts.join(", ")}\n`);
    }

    // Function list — compact, one line per function
    if (contract.functions.length > 0) {
      lines.push("**Functions:**");
      for (const fn of contract.functions) {
        const label = fnLabel(fn);
        const params = fn.params.join(", ");
        const ret = fn.returns.length > 0 ? ` → ${fn.returns.join(", ")}` : "";
        const mods = fn.modifiers.length > 0 ? ` [${fn.modifiers.join(", ")}]` : "";
        lines.push(`- \`${label}(${params})${ret}\` — ${fn.visibility} ${fn.mutability}${mods}`);
      }
      lines.push("");
    }

    // External calls — only functions that make them
    const externalFuncs = contract.functions.filter((f) => f.externalCalls.length > 0);
    if (externalFuncs.length > 0) {
      lines.push("**External Calls:**");
      for (const fn of externalFuncs) {
        lines.push(`- \`${fnLabel(fn)}\`: ${fn.externalCalls.map((c) => `\`${c}\``).join(", ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
};

const generateMarkdown = (imports: string[], contracts: ContractAnalysis[]) => {
  const lines: string[] = [];
  lines.push("# Solidity Contract Analysis\n");

  // Imports
  lines.push("## Imports\n");
  if (imports.length === 0) {
    lines.push("_No imports._\n");
  } else {
    for (const imp of imports) lines.push(`- \`${imp}\``);
    lines.push("");
  }

  for (const contract of contracts) {
    const kindLabel = contract.kind.charAt(0).toUpperCase() + contract.kind.slice(1);
    lines.push(`---\n\n## ${kindLabel}: \`${contract.name}\`\n`);

    // Inheritance
    lines.push("### Inheritance\n");
    if (contract.baseContracts.length === 0) {
      lines.push("_None._\n");
    } else {
      for (const base of contract.baseContracts) lines.push(`- \`${base}\``);
      lines.push("");
    }

    // Using For
    if (contract.usingFor.length > 0) {
      lines.push("### Using For\n");
      for (const u of contract.usingFor) lines.push(`- ${u}`);
      lines.push("");
    }

    // Storage layout
    lines.push("### Storage Layout (State Variables)\n");
    if (contract.stateVars.length === 0) {
      lines.push("_No state variables._\n");
    } else {
      lines.push("| Slot | Name | Type | Visibility | Flags |");
      lines.push("|------|------|------|------------|-------|");
      contract.stateVars.forEach((v, i) => {
        const flags = [v.constant && "constant", v.immutable && "immutable"].filter(Boolean).join(", ");
        lines.push(`| ${i} | \`${v.name}\` | \`${v.type}\` | ${v.visibility} | ${flags} |`);
      });
      lines.push("");
    }

    // Events
    lines.push("### Events\n");
    if (contract.events.length === 0) {
      lines.push("_No events._\n");
    } else {
      for (const evt of contract.events) {
        const params = evt.params.join(", ");
        lines.push(`- **\`${evt.name}\`**\`(${params})\`${evt.anonymous ? " _(anonymous)_" : ""}`);
      }
      lines.push("");
    }

    // Modifiers
    lines.push("### Modifiers\n");
    if (contract.modifiers.length === 0) {
      lines.push("_No modifiers._\n");
    } else {
      for (const mod of contract.modifiers) {
        lines.push(`- **\`${mod.name}\`**\`(${mod.params.join(", ")})\``);
      }
      lines.push("");
    }

    // Function list
    lines.push("### Function List\n");
    if (contract.functions.length === 0) {
      lines.push("_No functions._\n");
    } else {
      lines.push("| Name | Visibility | Mutability | Parameters | Returns | Modifiers |");
      lines.push("|------|------------|------------|------------|---------|-----------|");
      for (const fn of contract.functions) {
        lines.push(
          `| \`${fnLabel(fn)}\` | ${fn.visibility} | ${fn.mutability} | \`${fn.params.join(", ")}\` | \`${fn.returns.join(", ")}\` | ${fn.modifiers.join(", ")} |`,
        );
      }
      lines.push("");
    }

    // Call graph
    lines.push("### Call Graph\n");
    const hasCalls = contract.functions.some((f) => f.internalCalls.length > 0 || f.externalCalls.length > 0);
    if (!hasCalls) {
      lines.push("_No function calls detected._\n");
    } else {
      for (const fn of contract.functions) {
        if (fn.internalCalls.length === 0 && fn.externalCalls.length === 0) continue;
        lines.push(`**\`${fnLabel(fn)}\`**`);
        for (const call of fn.internalCalls) lines.push(`  - → \`${call}\` _(internal)_`);
        for (const call of fn.externalCalls) lines.push(`  - → \`${call}\` _(external)_`);
      }
      lines.push("");
    }

    // External calls
    lines.push("### External Calls\n");
    const externalFuncs = contract.functions.filter((f) => f.externalCalls.length > 0);
    if (externalFuncs.length === 0) {
      lines.push("_No external calls detected._\n");
    } else {
      for (const fn of externalFuncs) {
        lines.push(`**\`${fnLabel(fn)}\`**`);
        for (const call of fn.externalCalls) lines.push(`  - \`${call}\``);
      }
      lines.push("");
    }

    // Internal recursion
    lines.push("### Internal Recursion\n");
    const callMap = new Map(contract.functions.map((f) => [fnLabel(f), f.internalCalls]));
    const recursiveFns = contract.functions.filter((fn) => hasCycle(fnLabel(fn), fnLabel(fn), callMap, new Set()));
    if (recursiveFns.length === 0) {
      lines.push("_No recursive functions detected._\n");
    } else {
      for (const fn of recursiveFns) lines.push(`- **\`${fnLabel(fn)}\`** is recursive`);
      lines.push("");
    }

    // State variable touchpoints
    lines.push("### State Variable Touchpoints\n");
    const touchedFns = contract.functions.filter((f) => f.stateReads.length > 0 || f.stateWrites.length > 0);
    if (touchedFns.length === 0) {
      lines.push("_No state variable accesses detected._\n");
    } else {
      lines.push("| Function | Reads | Writes |");
      lines.push("|----------|-------|--------|");
      for (const fn of touchedFns) {
        const reads = fn.stateReads.map((r) => `\`${r}\``).join(", ");
        const writes = fn.stateWrites.map((w) => `\`${w}\``).join(", ");
        lines.push(`| \`${fnLabel(fn)}\` | ${reads} | ${writes} |`);
      }
      lines.push("");
    }
  }

  // External dependencies summary
  lines.push("---\n\n## External Dependencies\n");

  lines.push("### Import Paths\n");
  if (imports.length === 0) {
    lines.push("_No imports._\n");
  } else {
    for (const imp of imports) lines.push(`- \`${imp}\``);
    lines.push("");
  }

  const externalTargets = new Set<string>();
  for (const contract of contracts) {
    for (const fn of contract.functions) {
      for (const call of fn.externalCalls) {
        const target = call.split(".")[0];
        if (target && target !== "<expr>") externalTargets.add(target);
      }
    }
  }

  lines.push("### External Contract Interactions\n");
  if (externalTargets.size === 0) {
    lines.push("_No external contract interactions detected._\n");
  } else {
    for (const dep of externalTargets) lines.push(`- \`${dep}\``);
    lines.push("");
  }

  return lines.join("\n");
};

export const analyzeSolidityFile = async (soliditySource: string, mode: "full" | "short") => {
  let ast: any;

  try {
    ast = parse(soliditySource, { tolerant: true, loc: true, range: true });
  } catch (e: any) {
    return `# Parse Error\n\nFailed to parse Solidity source: ${e.message as string}`;
  }

  const imports: string[] = [];
  const contracts: ContractAnalysis[] = [];

  for (const node of ast.children ?? []) {
    if (node.type === "ImportDirective") {
      imports.push(node.path as string);
    }
  }

  for (const node of ast.children ?? []) {
    if (node.type !== "ContractDefinition") continue;

    const contract: ContractAnalysis = {
      name: node.name as string,
      kind: (node.kind as string) ?? "contract",
      baseContracts: (node.baseContracts ?? []).map(
        (bc: any) => (bc.baseName?.namePath ?? bc.baseName?.name ?? "?") as string,
      ),
      usingFor: [],
      stateVars: [],
      events: [],
      modifiers: [],
      functions: [],
    };

    const stateVarNames = new Set<string>();

    for (const member of node.subNodes ?? []) {
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
          });
          break;
        }

        case "ModifierDefinition":
          contract.modifiers.push({
            name: member.name as string,
            params: (member.parameters ?? []).map(paramToString),
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
          });
          break;
        }

        case "UsingForDeclaration": {
          const forType = member.typeName ? typeToString(member.typeName) : "*";
          if (member.libraryName) {
            contract.usingFor.push(`\`${member.libraryName as string}\` for \`${forType}\``);
          } else {
            // New-style: using {fn1, fn2, ...} for T
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

  return mode === "short" ? generateShortMarkdown(imports, contracts) : generateMarkdown(imports, contracts);
};

export const solidityAnalyzerTool = tool(
  async ({ solidityFile, mode }) => {
    return analyzeSolidityFile(solidityFile, mode);
  },
  {
    name: "solidity_analyzer",
    description:
      "Parse a Solidity source file and generate a markdown report. Use mode='short' for a compact token-efficient summary (imports, state, modifiers, events, function signatures, external calls). Use mode='full' for the complete report including storage layout table, call graph, recursion detection, state variable touchpoints, and external dependencies.",
    schema: z.object({
      solidityFile: z.string().describe("The full Solidity source code to analyze."),
      mode: z
        .enum(["full", "short"])
        .default("full")
        .describe("Report verbosity. 'short' saves tokens; 'full' provides the complete analysis."),
    }),
  },
);

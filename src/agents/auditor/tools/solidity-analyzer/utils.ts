import { visit } from "@solidity-parser/parser";

const ASSIGNMENT_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", "<<=", ">>=", "**="]);
const BUILTIN_NAMESPACES = new Set(["abi", "block", "msg", "tx", "bytes", "string", "type"]);

export interface NatSpec {
  title?: string;
  author?: string;
  notice?: string;
  dev?: string;
  params: Record<string, string>;
  returns: string[];
  inheritdoc?: string;
  custom: Record<string, string>;
}

export interface ParsedComment {
  text: string;
  startLine: number;
  endLine: number;
  isNatSpec: boolean;
  natspec?: NatSpec;
}

export interface StateVar {
  name: string;
  type: string;
  visibility: string;
  constant: boolean;
  immutable: boolean;
  natspec?: NatSpec;
}

export interface EventDef {
  name: string;
  params: string[];
  anonymous: boolean;
  natspec?: NatSpec;
}

export interface ErrorDef {
  name: string;
  params: string[];
  natspec?: NatSpec;
}

export interface ModifierDef {
  name: string;
  params: string[];
  natspec?: NatSpec;
}

export interface FunctionDef {
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
  natspec?: NatSpec;
}

export interface ContractAnalysis {
  name: string;
  kind: string;
  baseContracts: string[];
  usingFor: string[];
  stateVars: StateVar[];
  events: EventDef[];
  errors: ErrorDef[];
  modifiers: ModifierDef[];
  functions: FunctionDef[];
  natspec?: NatSpec;
}

export interface RenderOptions {
  filePath?: string;
  importance?: number;
  lineCount: number;
  solcVersion: string;
}

export const extractSolcVersion = (source: string): string => {
  const match = source.match(/pragma\s+solidity\s+([^;]+);/);
  return match ? match[1].trim() : "—";
};

const parseNatSpecTags = (text: string): NatSpec => {
  const result: NatSpec = { params: {}, returns: [], custom: {} };

  const firstTag = text.search(/@(?:title|author|notice|dev|param|return|inheritdoc|custom:)/);
  if (firstTag > 0) {
    const implicit = text.slice(0, firstTag).trim();
    if (implicit) result.notice = implicit.replace(/\n\s*/g, " ");
  } else if (firstTag === -1 && text.trim()) {
    result.notice = text.trim().replace(/\n\s*/g, " ");
  }

  const tagRe = /@(custom:\S+|\w+)([^@]*)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    const tag = m[1];
    const value = m[2].trim().replace(/\n\s*/g, " ");
    if (tag === "title") result.title = value;
    else if (tag === "author") result.author = value;
    else if (tag === "notice") result.notice = value;
    else if (tag === "dev") result.dev = value;
    else if (tag === "inheritdoc") result.inheritdoc = value;
    else if (tag === "param") {
      const sp = value.indexOf(" ");
      if (sp > 0) result.params[value.slice(0, sp)] = value.slice(sp + 1);
      else if (value) result.params[value] = "";
    } else if (tag === "return") result.returns.push(value);
    else if (tag.startsWith("custom:")) result.custom[tag.slice(7)] = value;
  }

  return result;
};

export const buildCommentBlocks = (source: string): ParsedComment[] => {
  const blocks: ParsedComment[] = [];
  const lines = source.split("\n");
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trimStart();

    if (trimmed.startsWith("///")) {
      const startLine = i + 1;
      const texts: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("///")) {
        texts.push(lines[i].trimStart().slice(3).replace(/^ /, ""));
        i++;
      }
      const text = texts.join("\n");
      blocks.push({ text, startLine, endLine: i, isNatSpec: true, natspec: parseNatSpecTags(text) });
      continue;
    }

    const mlStart = raw.indexOf("/*");
    if (mlStart !== -1) {
      const isNatSpec = raw[mlStart + 2] === "*" && raw[mlStart + 3] !== "/";
      const startLine = i + 1;
      const closeOnSame = raw.indexOf("*/", mlStart + 2);

      if (closeOnSame !== -1) {
        const inner = raw.slice(mlStart + (isNatSpec ? 3 : 2), closeOnSame).trim();
        blocks.push({
          text: inner,
          startLine,
          endLine: startLine,
          isNatSpec,
          natspec: isNatSpec ? parseNatSpecTags(inner) : undefined,
        });
        i++;
        continue;
      }

      const rawLines: string[] = [raw.slice(mlStart + (isNatSpec ? 3 : 2))];
      i++;
      while (i < lines.length) {
        const closeIdx = lines[i].indexOf("*/");
        if (closeIdx !== -1) {
          rawLines.push(lines[i].slice(0, closeIdx));
          i++;
          break;
        }
        rawLines.push(lines[i]);
        i++;
      }
      const text = rawLines
        .map((l) => l.replace(/^\s*\*\s?/, ""))
        .join("\n")
        .trim();
      blocks.push({ text, startLine, endLine: i, isNatSpec, natspec: isNatSpec ? parseNatSpecTags(text) : undefined });
      continue;
    }

    if (trimmed.startsWith("//")) {
      blocks.push({ text: trimmed.slice(2).trim(), startLine: i + 1, endLine: i + 1, isNatSpec: false });
    }

    i++;
  }

  return blocks;
};

export const findCommentFor = (line: number, comments: ParsedComment[]): ParsedComment | undefined =>
  comments.find((c) => c.endLine === line - 1) ?? comments.find((c) => c.startLine === line && !c.isNatSpec);

export const typeToString = (node: any): string => {
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

export const paramToString = (p: any): string => {
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

export const analyzeFunction = (funcNode: any, stateVarNames: Set<string>) => {
  const internalCalls = new Set<string>();
  const externalCalls = new Set<string>();
  const writeTargets = new Set<string>();
  const allStateAccesses = new Set<string>();
  const localVars = new Set<string>();

  if (!funcNode.body) {
    return { internalCalls: [], externalCalls: [], stateReads: [], stateWrites: [] };
  }

  for (const p of funcNode.parameters ?? []) {
    if (p?.name) localVars.add(p.name as string);
  }
  for (const p of funcNode.returnParameters ?? []) {
    if (p?.name) localVars.add(p.name as string);
  }

  visit(funcNode.body, {
    VariableDeclarationStatement: (node: any) => {
      for (const v of node.variables ?? []) {
        if (v?.name) localVars.add(v.name as string);
      }
    },
  });

  const effectiveStateVars = new Set([...stateVarNames].filter((v) => !localVars.has(v)));

  visit(funcNode.body, {
    ExpressionStatement: (node: any) => {
      const expr = node.expression;
      if (expr?.type === "BinaryOperation" && ASSIGNMENT_OPS.has(expr.operator as string)) {
        collectLHSRoots(expr.left, writeTargets);
      }
      if (
        expr?.type === "UnaryOperation" &&
        (expr.operator === "++" || expr.operator === "--" || expr.operator === "delete")
      ) {
        collectLHSRoots(expr.subExpression, writeTargets);
      }
    },
  });

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
          // builtin namespace — skip
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

  return {
    internalCalls: [...internalCalls],
    externalCalls: [...externalCalls],
    stateReads: [...allStateAccesses],
    stateWrites,
  };
};

export const hasCycle = (
  start: string,
  current: string,
  callMap: Map<string, string[]>,
  visited: Set<string>,
): boolean => {
  for (const callee of callMap.get(current) ?? []) {
    if (callee === start) return true;
    if (!visited.has(callee)) {
      visited.add(callee);
      if (hasCycle(start, callee, callMap, visited)) return true;
    }
  }
  return false;
};

export const fnLabel = (fn: FunctionDef): string => {
  if (fn.isConstructor) return "constructor";
  if (fn.isReceive) return "receive";
  if (fn.isFallback) return "fallback";
  return fn.name;
};

const renderNatSpec = (ns: NatSpec | undefined): string => {
  if (!ns) return "—";
  const parts: string[] = [];
  if (ns.title) parts.push(`@title "${ns.title}"`);
  if (ns.author) parts.push(`@author "${ns.author}"`);
  if (ns.notice) parts.push(`@notice "${ns.notice}"`);
  if (ns.dev) parts.push(`@dev "${ns.dev}"`);
  for (const [k, v] of Object.entries(ns.params)) {
    parts.push(v ? `@param ${k}: "${v}"` : `@param ${k}`);
  }
  for (const r of ns.returns) {
    if (r) parts.push(`@return "${r}"`);
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
};

const renderContractFull = (contract: ContractAnalysis, imports: string[], lines: string[]) => {
  lines.push("## Meta");
  const inherits = contract.baseContracts.length > 0 ? `[${contract.baseContracts.join(", ")}]` : "—";
  lines.push(`- kind: ${contract.kind} · inherits: ${inherits}`);
  if (contract.usingFor.length > 0) lines.push(`- uses: [${contract.usingFor.join(", ")}]`);
  lines.push(`- imports: ${imports.length > 0 ? imports.map((i) => `\`${i}\``).join(", ") : "—"}`);
  lines.push(`- docs: ${renderNatSpec(contract.natspec)}`);
  lines.push("");

  if (contract.stateVars.length > 0) {
    lines.push("## Storage");
    lines.push("| name | type | vis | flags | desc |");
    lines.push("|------|------|-----|-------|------|");
    for (const v of contract.stateVars) {
      const flags = [v.constant && "constant", v.immutable && "immutable"].filter(Boolean).join(", ") || "—";
      const desc = v.natspec?.notice ?? v.natspec?.dev ?? "—";
      lines.push(`| \`${v.name}\` | \`${v.type}\` | ${v.visibility} | ${flags} | ${desc} |`);
    }
    lines.push("");
  }

  if (contract.events.length > 0) {
    lines.push("## Events");
    for (const e of contract.events) {
      const notice = e.natspec?.notice ? ` — ${e.natspec.notice}` : "";
      lines.push(`- \`${e.name}(${e.params.join(", ")})\`${e.anonymous ? " _(anon)_" : ""}${notice}`);
    }
    lines.push("");
  }

  lines.push("## Errors");
  if (contract.errors.length === 0) {
    lines.push("- None");
  } else {
    for (const e of contract.errors) lines.push(`- \`${e.name}(${e.params.join(", ")})\``);
  }
  lines.push("");

  if (contract.modifiers.length > 0) {
    lines.push("## Modifiers");
    for (const m of contract.modifiers) {
      const notice = m.natspec?.notice ? ` — ${m.natspec.notice}` : "";
      lines.push(`- \`${m.name}(${m.params.join(", ")})\`${notice}`);
    }
    lines.push("");
  }

  const allExternalCalls = new Set(contract.functions.flatMap((f) => f.externalCalls));
  if (allExternalCalls.size > 0) {
    lines.push("## External Calls");
    for (const call of allExternalCalls) lines.push(`- \`${call}\``);
    lines.push("");
  }

  if (contract.functions.length > 0) {
    lines.push("## Functions");
    lines.push("");

    const callMap = new Map(contract.functions.map((f) => [fnLabel(f), f.internalCalls]));

    for (const fn of contract.functions) {
      const label = fnLabel(fn);
      lines.push(`### ${label}`);

      const modsStr = fn.modifiers.length > 0 ? ` · modifiers: [${fn.modifiers.join(", ")}]` : "";
      lines.push(`- visibility: ${fn.visibility} · mutability: ${fn.mutability}${modsStr}`);

      const paramsStr = fn.params.length > 0 ? fn.params.join(", ") : "—";
      const returnsStr = fn.returns.length > 0 ? `\`${fn.returns.join(", ")}\`` : "—";
      lines.push(`- parameters: \`(${paramsStr})\` · returns: ${returnsStr}`);

      if (fn.externalCalls.length > 0) {
        lines.push(`- calls: [${fn.externalCalls.map((c) => `\`${c}\``).join(", ")}]`);
      }
      if (fn.internalCalls.length > 0) {
        lines.push(`- graph: \`${fn.internalCalls.map((c) => `${label} → ${c}`).join(", ")}\``);
      }

      lines.push(`- recurse: ${hasCycle(label, label, callMap, new Set()) ? "yes ⚠" : "no"}`);

      if (fn.stateReads.length > 0 || fn.stateWrites.length > 0) {
        const reads = fn.stateReads.length > 0 ? fn.stateReads.map((r) => `\`${r}\``).join(", ") : "—";
        const writes = fn.stateWrites.length > 0 ? fn.stateWrites.map((w) => `\`${w}\``).join(", ") : "—";
        lines.push(`- state: reads [${reads}] · writes [${writes}]`);
      }

      lines.push(`- docs: ${renderNatSpec(fn.natspec)}`);
      lines.push("");
    }
  }
};

const renderContractBrief = (contract: ContractAnalysis, imports: string[], lines: string[]) => {
  lines.push("## Meta");
  const inherits = contract.baseContracts.length > 0 ? `[${contract.baseContracts.join(", ")}]` : "—";
  const importsList = imports.length > 0 ? imports.map((i) => `\`${i}\``).join(", ") : "—";
  lines.push(`- kind: ${contract.kind} · inherits: ${inherits}`);
  lines.push(`- imports: ${importsList}`);
  lines.push(`- docs: ${renderNatSpec(contract.natspec)}`);
  lines.push("");

  const allExternalCalls = new Set(contract.functions.flatMap((f) => f.externalCalls));
  if (allExternalCalls.size > 0) {
    lines.push("## External Calls");
    lines.push([...allExternalCalls].map((c) => `\`${c}\``).join(" · "));
    lines.push("");
  }

  if (contract.functions.length > 0) {
    lines.push("## Functions");
    lines.push("| function | visibility | mutability | parameters | returns | modifiers |");
    lines.push("|----------|------------|------------|------------|---------|-----------|");
    for (const fn of contract.functions) {
      const label = fnLabel(fn);
      const params = fn.params.length > 0 ? fn.params.join(", ") : "—";
      const returns = fn.returns.length > 0 ? fn.returns.join(", ") : "—";
      const mods = fn.modifiers.length > 0 ? fn.modifiers.join(", ") : "—";
      lines.push(`| \`${label}\` | ${fn.visibility} | ${fn.mutability} | ${params} | ${returns} | ${mods} |`);
    }
    lines.push("");
  }
};

const fileHeader = (contracts: ContractAnalysis[], mode: "full" | "short", opts: RenderOptions): string[] => {
  const names = contracts.map((c) => c.name).join(", ");
  const label = mode === "full" ? "FULL" : "BRIEF";
  const rankStr = opts.importance !== undefined ? ` | importance: ${opts.importance}/5` : "";
  return [
    `# ${names} · ${label}`,
    `> path: \`${opts.filePath ?? "—"}\` | lines: ${opts.lineCount} | solc: ${opts.solcVersion}${rankStr}`,
    "",
  ];
};

export const generateFullMarkdown = (imports: string[], contracts: ContractAnalysis[], opts: RenderOptions): string => {
  const lines: string[] = fileHeader(contracts, "full", opts);

  for (let i = 0; i < contracts.length; i++) {
    if (contracts.length > 1) {
      if (i > 0) lines.push("---", "");
      lines.push(`## ◆ ${contracts[i].name}`, "");
    }
    renderContractFull(contracts[i], imports, lines);
  }

  return lines.join("\n");
};

export const generateBriefMarkdown = (
  imports: string[],
  contracts: ContractAnalysis[],
  opts: RenderOptions,
): string => {
  const lines: string[] = fileHeader(contracts, "short", opts);

  for (let i = 0; i < contracts.length; i++) {
    if (contracts.length > 1) {
      if (i > 0) lines.push("---", "");
      lines.push(`## ◆ ${contracts[i].name}`, "");
    }
    renderContractBrief(contracts[i], imports, lines);
  }

  return lines.join("\n");
};

import fs from "node:fs";
import path from "node:path";

import { tool } from "langchain";
import { z } from "zod";

import { DOC_BASENAMES, DOC_EXTS, MAX_DEPTH, SKIP_DIRS, SOL_EXT, SOL_TEST_SUFFIXES } from "../../config.ts";

const CONFIG_FILES = new Set([
  "foundry.toml",
  "hardhat.config.js",
  "hardhat.config.ts",
  "remappings.txt",
  "package.json",
]);

interface TreeNode {
  name: string;
  isDir: boolean;
  children?: TreeNode[];
  tag?: string;
}

const buildTree = (dir: string, depth: number): TreeNode[] => {
  if (depth > MAX_DEPTH) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: TreeNode[] = [];

  for (const entry of [...entries].sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const children = buildTree(path.join(dir, entry.name), depth + 1);
      if (children.length > 0) nodes.push({ name: entry.name, isDir: true, children });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const base = path.basename(entry.name, ext).toLowerCase();

      if (ext === SOL_EXT) {
        const isTest = SOL_TEST_SUFFIXES.some((suffix) => entry.name.endsWith(suffix));
        nodes.push({ name: entry.name, isDir: false, tag: isTest ? "[test]" : "[sol]" });
      } else if (DOC_EXTS.has(ext) || DOC_BASENAMES.has(base)) {
        nodes.push({ name: entry.name, isDir: false, tag: "[doc]" });
      } else if (CONFIG_FILES.has(entry.name)) {
        nodes.push({ name: entry.name, isDir: false, tag: "[config]" });
      }
    }
  }

  return nodes;
};

const renderTree = (nodes: TreeNode[], prefix: string): string => {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    if (node.isDir) {
      lines.push(`${prefix}${connector}${node.name}/`);
      if (node.children && node.children.length > 0) {
        lines.push(renderTree(node.children, prefix + childPrefix));
      }
    } else {
      lines.push(`${prefix}${connector}${node.name} ${node.tag}`);
    }
  }

  return lines.join("\n");
};

export const buildRepoTree = (repoPath: string): string => {
  const nodes = buildTree(repoPath, 0);
  if (nodes.length === 0) return "(no relevant files found)";

  const repoName = path.basename(repoPath);
  return `${repoName}/\n${renderTree(nodes, "")}`;
};

export const repoTreeTool = tool(async ({ repoPath }) => buildRepoTree(repoPath), {
  name: "repo_tree",
  description:
    "Walk a repository and return a file-system tree of relevant files tagged by kind: [sol] for auditable Solidity contracts, [test] for Solidity test files, [doc] for documentation, and [config] for project config files. Use this during Define Scope to understand repository layout before selecting which files to audit.",
  schema: z.object({
    repoPath: z.string().describe("Absolute path to the repository root."),
  }),
});

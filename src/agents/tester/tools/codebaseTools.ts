import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

export const createSearchCodebaseTool = (sandboxDir: string) => {
  return tool(
    async ({ query }) => {
      try {
        // Find .sol files containing the query in the sandboxDir
        const { stdout } = await execAsync(`grep -rn --include="*.sol" "${query}" .`, { cwd: sandboxDir });
        const lines = stdout.split("\n").filter(l => l.trim() !== "");
        if (lines.length === 0) return "No results found.";
        
        const preview = lines.slice(0, 30);
        const truncatedMsg = lines.length > 30 ? `\n...and ${lines.length - 30} more results.` : "";
        return `Found ${lines.length} results. Showing first 30:\n${preview.join("\n")}${truncatedMsg}`;
      } catch (e: any) {
        if (e.code === 1) return "No results found."; // grep exit code 1 means no match
        return `Error searching codebase: ${e.message}`;
      }
    },
    {
      name: "searchCodebase",
      description: "Searches the codebase for a specific string (like a struct, contract name, or interface) and returns the file paths and matching lines.",
      schema: z.object({
        query: z.string().describe("The exact string to search for. Keep it simple, e.g. 'LiquidateWithReplacementParams' or 'SizeFactory'"),
      }),
    }
  );
};

export const createReadFileTool = (sandboxDir: string) => {
  return tool(
    async ({ filePath }) => {
      try {
        const fullPath = path.resolve(sandboxDir, filePath);
        // Security check to avoid path traversal
        if (!fullPath.startsWith(path.resolve(sandboxDir))) {
          return "Error: Cannot read files outside the sandbox directory.";
        }
        const content = await fs.readFile(fullPath, "utf-8");
        
        // Truncate if extremely large to save context window, though Solidity files are usually small enough
        if (content.length > 20000) {
           return content.slice(0, 20000) + "\n\n... [TRUNCATED] File too large.";
        }
        return content;
      } catch (e: any) {
        return `Error reading file: ${e.message}`;
      }
    },
    {
      name: "readFile",
      description: "Reads the content of a specific file. Pass the relative file path returned by searchCodebase.",
      schema: z.object({
        filePath: z.string().describe("The relative path of the file to read (e.g. 'src/Size.sol')"),
      }),
    }
  );
};

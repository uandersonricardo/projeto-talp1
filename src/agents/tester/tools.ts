import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Exploration Tools (Basic Tools)
// ---------------------------------------------------------------------------

export const readFileTool = tool(
  async ({ filePath }, config) => {
    try {
      // The sandboxDir is passed in via the config.configurable object
      const sandboxDir = config?.configurable?.sandboxDir || process.cwd();
      const absolutePath = path.resolve(sandboxDir, filePath);
      
      // Prevent directory traversal outside sandbox
      if (!absolutePath.startsWith(path.resolve(sandboxDir))) {
        return "Error: Access denied. Cannot read files outside the project sandbox.";
      }

      const content = await fs.readFile(absolutePath, "utf-8");
      return content;
    } catch (e: any) {
      return `Error reading file: ${e.message}`;
    }
  },
  {
    name: "read_file",
    description: "Reads the contents of a specific file in the project.",
    schema: z.object({
      filePath: z.string().describe("The relative path to the file to read (e.g. 'src/Vault.sol')"),
    }),
  }
);

export const listDirTool = tool(
  async ({ dirPath }, config) => {
    try {
      const sandboxDir = config?.configurable?.sandboxDir || process.cwd();
      const absolutePath = path.resolve(sandboxDir, dirPath || ".");
      
      if (!absolutePath.startsWith(path.resolve(sandboxDir))) {
        return "Error: Access denied. Cannot list directories outside the project sandbox.";
      }

      const files = await fs.readdir(absolutePath, { withFileTypes: true });
      return files.map(f => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`).join("\n");
    } catch (e: any) {
      return `Error listing directory: ${e.message}`;
    }
  },
  {
    name: "list_dir",
    description: "Lists files and directories in a given path to understand project structure.",
    schema: z.object({
      dirPath: z.string().optional().describe("The relative path to the directory (e.g. 'src' or 'test/mocks'). Defaults to root."),
    }),
  }
);

export const grepSearchTool = tool(
  async ({ query, dirPath }, config) => {
    try {
      const sandboxDir = config?.configurable?.sandboxDir || process.cwd();
      const targetDir = path.resolve(sandboxDir, dirPath || ".");
      
      // Use grep -rnw to search recursively
      // Note: In a real production system, use a safe regex/grep library or escape properly.
      const cmd = `grep -rn "${query.replace(/"/g, '\\"')}" ${targetDir} | head -n 50`;
      
      const { stdout } = await execAsync(cmd);
      return stdout || "No matches found.";
    } catch (e: any) {
      // grep returns exit code 1 if no matches are found
      if (e.code === 1) return "No matches found.";
      return `Error executing search: ${e.message}`;
    }
  },
  {
    name: "grep_search",
    description: "Searches the codebase recursively for specific symbols, variable names, or interfaces.",
    schema: z.object({
      query: z.string().describe("The text or symbol to search for (e.g. 'interface IERC20' or 'withdraw(')"),
      dirPath: z.string().optional().describe("The relative directory to search in (e.g. 'src'). Defaults to root."),
    }),
  }
);

// ---------------------------------------------------------------------------
// Modification Tools (File Editing)
// ---------------------------------------------------------------------------

export const writeFileTool = tool(
  async ({ filePath, content }, config) => {
    try {
      if (filePath === "foundry.toml" || filePath === "remappings.txt" || filePath.endsWith(".gitmodules")) {
        return "Error: You are strictly forbidden from modifying foundry.toml, remappings.txt, or .gitmodules. The environment is already perfectly configured.";
      }
      const sandboxDir = config?.configurable?.sandboxDir || process.cwd();
      const absolutePath = path.resolve(sandboxDir, filePath);
      
      if (!absolutePath.startsWith(path.resolve(sandboxDir))) {
        return "Error: Access denied. Cannot write files outside the project sandbox.";
      }

      // Ensure directory exists
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, "utf-8");
      
      return `Successfully wrote to ${filePath}`;
    } catch (e: any) {
      return `Error writing file: ${e.message}`;
    }
  },
  {
    name: "write_file",
    description: "Writes or overwrites a file with the provided content. Primarily used to write 'test/Exploit.t.sol'.",
    schema: z.object({
      filePath: z.string().describe("The relative path to write to (e.g. 'test/Exploit.t.sol')"),
      content: z.string().describe("The full content of the file to write."),
    }),
  }
);

export const editFileTool = tool(
  async ({ filePath, searchString, replacementString }, config) => {
    try {
      if (filePath === "foundry.toml" || filePath === "remappings.txt" || filePath.endsWith(".gitmodules")) {
        return "Error: You are strictly forbidden from modifying foundry.toml, remappings.txt, or .gitmodules. The environment is already perfectly configured.";
      }
      const sandboxDir = config?.configurable?.sandboxDir || process.cwd();
      const absolutePath = path.resolve(sandboxDir, filePath);
      
      if (!absolutePath.startsWith(path.resolve(sandboxDir))) {
        return "Error: Access denied. Cannot edit files outside the project sandbox.";
      }

      const content = await fs.readFile(absolutePath, "utf-8");
      
      if (!content.includes(searchString)) {
        return "Error: searchString not found in the file. Ensure you pass the exact string to be replaced.";
      }
      
      // We only replace the first occurrence or all? Replacing all is safer if they match exactly.
      // But standard string replace only replaces the first occurrence, which is safer if multiple matches exist.
      const newContent = content.replace(searchString, replacementString);
      
      if (newContent === content) {
         return "Error: replacement resulted in no changes.";
      }
      
      await fs.writeFile(absolutePath, newContent, "utf-8");
      
      return `Successfully edited ${filePath}`;
    } catch (e: any) {
      return `Error editing file: ${e.message}`;
    }
  },
  {
    name: "edit_file",
    description: "Edits an existing file by replacing a specific block of text. Use this instead of write_file for small changes.",
    schema: z.object({
      filePath: z.string().describe("The relative path to edit (e.g. 'test/Exploit.t.sol')"),
      searchString: z.string().describe("The exact text block to search for and replace. Must match perfectly including whitespace."),
      replacementString: z.string().describe("The new text block to insert in place of searchString."),
    }),
  }
);

// ---------------------------------------------------------------------------
// Smart Contract Tools (Execution Feedback)
// ---------------------------------------------------------------------------

export const smartContractCompileTool = tool(
  async (_, config) => {
    try {
      const sandboxDir = config?.configurable?.sandboxDir || process.cwd();
      
      const { stdout, stderr } = await execAsync(
        "forge build",
        { 
          cwd: sandboxDir, 
          timeout: 30000,
          env: { ...process.env } 
        }
      );
      
      const out = stdout ? String(stdout).slice(-4000) : "";
      const errOut = stderr ? String(stderr).slice(-4000) : "";
      return `Compilation Successful:\nSTDOUT:\n${out}\nSTDERR:\n${errOut}`;
    } catch (err: any) {
      if (err.killed || err.signal === "SIGTERM") {
        return "Error: Compilation timed out after 30s.";
      }
      const out = err.stdout ? String(err.stdout).slice(-4000) : "";
      const errOut = err.stderr ? String(err.stderr).slice(-4000) : "";
      return `Compilation Failed:\nSTDOUT:\n${out}\nSTDERR:\n${errOut}`;
    }
  },
  {
    name: "smart_contract_compile",
    description: "Runs 'forge build' to compile the smart contracts and tests. Returns stdout and stderr. Use this to check for syntax errors before testing.",
    schema: z.object({}),
  }
);

export const smartContractTestTool = tool(
  async ({ testMatch }, config) => {
    try {
      const sandboxDir = config?.configurable?.sandboxDir || process.cwd();
      const matchArg = testMatch ? `--match-contract ${testMatch}` : "";
      
      const { stdout, stderr } = await execAsync(
        `forge test ${matchArg} -vvvv`,
        { 
          cwd: sandboxDir, 
          timeout: 60000,
          env: { ...process.env } 
        }
      );
      
      const out = stdout ? String(stdout).slice(-4000) : "";
      const errOut = stderr ? String(stderr).slice(-4000) : "";
      return `Test Passed Successfully!\nSTDOUT:\n${out}\nSTDERR:\n${errOut}`;
    } catch (err: any) {
      if (err.killed || err.signal === "SIGTERM") {
        return "Error: Test execution timed out after 60s.";
      }
      const out = err.stdout ? String(err.stdout).slice(-4000) : "";
      const errOut = err.stderr ? String(err.stderr).slice(-4000) : "";
      return `Test Failed:\nSTDOUT:\n${out}\nSTDERR:\n${errOut}`;
    }
  },
  {
    name: "smart_contract_test",
    description: "Runs 'forge test -vvvv' to execute the PoC exploit. Returns the execution traces and assertions. Crucial for verifying if the exploit works or why it reverted.",
    schema: z.object({
      testMatch: z.string().optional().describe("Optional test contract name to match (e.g. 'ExploitTest')"),
    }),
  }
);

// ---------------------------------------------------------------------------
// Planning Tool
// ---------------------------------------------------------------------------

export const todoPlannerTool = tool(
  async ({ action, task }, config) => {
    try {
      const sandboxDir = config?.configurable?.sandboxDir || process.cwd();
      const todoPath = path.resolve(sandboxDir, "todo_plan.txt");
      
      if (action === "read") {
        try {
          return await fs.readFile(todoPath, "utf-8");
        } catch {
          return "No tasks found. Todo list is empty.";
        }
      }
      
      if (action === "add" && task) {
        await fs.appendFile(todoPath, `- [ ] ${task}\n`);
        return `Added task: ${task}`;
      }
      
      if (action === "update" && task) {
        // Overwrite with the full new state provided by the LLM
        await fs.writeFile(todoPath, task);
        return "Todo list updated.";
      }
      
      return "Invalid action.";
    } catch (e: any) {
      return `Error with planner: ${e.message}`;
    }
  },
  {
    name: "todo_planner",
    description: "A lightweight planning utility to organize tasks. Actions: 'read' to view tasks, 'add' to append a task, 'update' to overwrite the whole list with new state.",
    schema: z.object({
      action: z.enum(["read", "add", "update"]).describe("The action to perform."),
      task: z.string().optional().describe("The task text to add, or the full new list to update."),
    }),
  }
);

export const pocoTools = [
  readFileTool,
  listDirTool,
  grepSearchTool,
  writeFileTool,
  editFileTool,
  smartContractCompileTool,
  smartContractTestTool,
  todoPlannerTool
];

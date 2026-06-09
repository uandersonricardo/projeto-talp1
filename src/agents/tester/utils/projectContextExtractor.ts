import fs from "fs/promises";
import path from "path";

export interface ProjectContext {
  remappings: string;       // Content of remappings.txt or foundry.toml [profile.default.remappings]
  existingTestImports: string; // First few import lines from an existing test file
  foundryTomlProfile: string; // Relevant foundry.toml settings (src, libs)
  existingTestFilePath: string | null; // Relative path to an existing test file for reference
}

/**
 * Extracts project-level context needed for correct import paths in PoC tests.
 * Reads remappings.txt, foundry.toml, and the first existing test file in the project.
 */
export async function extractProjectContext(sandboxDir: string): Promise<ProjectContext> {
  let remappings = "";
  let foundryTomlProfile = "";
  let existingTestImports = "";
  let existingTestFilePath: string | null = null;

  // 1. Read remappings.txt
  try {
    const remappingsPath = path.join(sandboxDir, "remappings.txt");
    remappings = await fs.readFile(remappingsPath, "utf-8");
  } catch {
    // fallback: try to extract from foundry.toml
  }

  // 2. Read foundry.toml for additional context
  try {
    const foundryTomlPath = path.join(sandboxDir, "foundry.toml");
    const tomlContent = await fs.readFile(foundryTomlPath, "utf-8");
    // Extract relevant lines (src, libs, remappings)
    const relevantLines = tomlContent
      .split("\n")
      .filter(l =>
        l.includes("src") ||
        l.includes("libs") ||
        l.includes("remapping") ||
        l.includes("[profile")
      )
      .slice(0, 20)
      .join("\n");
    foundryTomlProfile = relevantLines;

    // If no remappings.txt, try to extract from foundry.toml remappings array
    if (!remappings) {
      const remappingMatch = tomlContent.match(/remappings\s*=\s*\[([\s\S]*?)\]/);
      if (remappingMatch) {
        remappings = remappingMatch[1]
          .split(",")
          .map(s => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean)
          .join("\n");
      }
    }
  } catch {
    // ignore
  }

  // 3. Find an existing test file to use as import reference
  try {
    const testDir = path.join(sandboxDir, "test");
    const testFile = await findFirstTestFile(testDir);
    if (testFile) {
      existingTestFilePath = path.relative(sandboxDir, testFile);
      const testContent = await fs.readFile(testFile, "utf-8");
      // Extract the first 20 lines which typically contain imports
      existingTestImports = testContent
        .split("\n")
        .slice(0, 25)
        .filter(l => l.startsWith("import") || l.startsWith("pragma") || l.startsWith("//") || l.startsWith("contract") || l.startsWith("abstract"))
        .join("\n");
    }
  } catch {
    // ignore
  }

  return { remappings, existingTestImports, foundryTomlProfile, existingTestFilePath };
}

/**
 * Recursively finds the best reference test file in the test directory.
 * Strategy:
 *  1. Collect ALL .t.sol files (excluding Exploit.t.sol) across all subdirs (BFS)
 *  2. Pick the one with the most import lines (most context-rich)
 *  3. Fallback to .sol files that have "import" statements (e.g. BaseTest.sol, Fixture.sol)
 *  4. Skip pure mock contracts (files in "mock" directories or named *Mock.sol)
 */
async function findFirstTestFile(dir: string): Promise<string | null> {
  const tSolFiles: string[] = [];
  const solFiles: string[] = [];

  // BFS collect all files
  const queue = [dir];
  let depth = 0;
  while (queue.length > 0 && depth < 4) {
    const currentDepth: string[] = [...queue];
    queue.length = 0;
    depth++;
    for (const currentDir of currentDepth) {
      let entries: import('fs').Dirent[];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true }) as import('fs').Dirent[];
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const name = entry.name as string;
        if (entry.isFile()) {
          if (name === "Exploit.t.sol") continue; // skip our own file
          if (name.endsWith(".t.sol")) {
            tSolFiles.push(fullPath);
          } else if (name.endsWith(".sol")) {
            // Skip mock contracts
            const isMock = name.toLowerCase().includes("mock") || currentDir.toLowerCase().includes("mock");
            if (!isMock) {
              solFiles.push(fullPath);
            }
          }
        } else if (entry.isDirectory()) {
          queue.push(fullPath);
        }
      }
    }
  }

  // Pick the .t.sol file with the most import lines (richest context)
  if (tSolFiles.length > 0) {
    let bestFile = tSolFiles[0];
    let bestImportCount = 0;
    for (const f of tSolFiles.slice(0, 10)) { // check up to 10
      try {
        const content = await fs.readFile(f, "utf-8");
        const importCount = (content.match(/^import/gm) ?? []).length;
        if (importCount > bestImportCount) {
          bestImportCount = importCount;
          bestFile = f;
        }
      } catch { /* skip */ }
    }
    return bestFile;
  }

  // Fallback: .sol files that have import statements (like BaseTest.sol, Fixture.sol)
  for (const f of solFiles.slice(0, 10)) {
    try {
      const content = await fs.readFile(f, "utf-8");
      if (content.includes("import ")) return f;
    } catch { /* skip */ }
  }

  return null;
}


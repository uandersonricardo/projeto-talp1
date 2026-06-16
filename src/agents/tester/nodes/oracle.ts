import fs from "fs/promises";
import path from "path";
import { PoCState } from "../state.js";
import { generateLocalScaffold } from "../tools/scaffoldGenerator.js";
import { extractConstructor } from "../utils/parserUtils.js";
import { analyzeSolidityFile } from "../../auditor/tools/solidity-analyzer-tool.js";
import { extractProjectContext } from "../utils/projectContextExtractor.js";
import { OracleContext } from "../types.js";

export async function oracleNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[oracleNode] gerando scaffold para:", state.report.title);

  const solidityScaffold = generateLocalScaffold(state.report);
  
  const constructorInfo = extractConstructor(state.report.affectedContract.sourceCode, state.report.affectedContract.name);
  
  console.log("[oracleNode] analisando API do contrato e helpers de teste...");
  const targetContractAPI = await analyzeSolidityFile(state.report.affectedContract.sourceCode, "short");
  
  let referenceTestHelpers = "";
  if (state.report.referenceTestCode) {
    referenceTestHelpers = await analyzeSolidityFile(state.report.referenceTestCode, "short");
  }

  let projectRemappings = "";
  let projectTestImports = "";
  let projectTestFilePath: string | null = null;
  if (state.report.customSandboxDir) {
    console.log("[oracleNode] extracting project context (remappings, test imports)...");
    try {
      const projectCtx = await extractProjectContext(state.report.customSandboxDir);
      projectRemappings = projectCtx.remappings;
      projectTestImports = projectCtx.existingTestImports;
      projectTestFilePath = projectCtx.existingTestFilePath;
    } catch (e) {
      console.warn("[oracleNode] could not extract project context:", (e as Error).message);
    }

    try {
      const testDir = path.join(state.report.customSandboxDir, "test");
      const testEntries = await fs.readdir(testDir, { withFileTypes: true }).catch(() => []);
      let removed = 0;
      for (const entry of testEntries) {
        if (entry.isFile() && entry.name.endsWith(".t.sol") && entry.name !== "Exploit.t.sol") {
          await fs.unlink(path.join(testDir, entry.name));
          removed++;
        }
      }
    } catch (e) {
      console.warn("[oracleNode] test cleanup failed:", (e as Error).message);
    }
  }

  const oracleContext: OracleContext = { 
    solidityScaffold,
    constructorInfo: constructorInfo?.parameters,
    targetContractAPI,
    referenceTestHelpers,
    projectRemappings,
    projectTestImports,
    projectTestFilePath,
  };

  // No longer generating static template. We leave it to the agent to build the setup.
  console.log("[oracleNode] scaffold generation skipped. Context built.");
  return { 
    oracleContext, 
    templateCode: "", 
    pocCode: "", 
    infrastructurePhase: false
  };
}

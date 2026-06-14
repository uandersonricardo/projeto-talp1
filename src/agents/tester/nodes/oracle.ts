import fs from "fs/promises";
import path from "path";
import { PoCState } from "../state.js";
import { generateLocalScaffold } from "../tools/scaffoldGenerator.js";
import { extractConstructor } from "../utils/parserUtils.js";
import { analyzeSolidityFile } from "../../auditor/tools/solidity-analyzer-tool.js";
import { extractProjectContext } from "../utils/projectContextExtractor.js";
import { createMissingDependencyStubs } from "../utils/dependencyStubber.js";
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

    try {
      await createMissingDependencyStubs(state.report.customSandboxDir);
    } catch (e) {
      console.warn("[oracleNode] stub creation failed:", (e as Error).message);
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

  // DETERMINISTIC TEMPLATE GENERATION
  const targetName = state.report.affectedContract.name;
  let setupArgs = "";
  if (constructorInfo?.parameters && Array.isArray(constructorInfo.parameters)) {
    const params = constructorInfo.parameters.map((p: any) => p.type === "address" ? "address(this)" : "0").join(", ");
    setupArgs = params;
  }

  // Parse projectTestImports to extract only the import paths if any
  let imports = `import "forge-std/Test.sol";\nimport "forge-std/console.sol";`;
  if (projectTestImports) {
    imports += "\n" + projectTestImports;
  }
  
  // Use relative path for target based on report or assume src/
  const targetFile = state.report.affectedContract.sourceFilePath ? `../${state.report.affectedContract.sourceFilePath}` : `../src/${targetName}.sol`;
  imports += `\nimport { ${targetName} } from "${targetFile}";`;

  const templateCode = `// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

${imports}

contract ExploitTest is Test {
    ${targetName} target;
    address constant ATTACKER = address(0xBEEF);

    function setUp() public virtual {
        target = new ${targetName}(${setupArgs});
        vm.deal(ATTACKER, 100 ether);
        require(address(target) != address(0), "Target must be deployed");
    }

    function test_Exploit() public {
        // INJECT_HACK
    }
}`;

  console.log("[oracleNode] scaffold gerado, context built. Deterministic Template generated.");
  return { 
    oracleContext, 
    templateCode, 
    pocCode: templateCode, // Sets initial state so foundry can try compiling it
    infrastructurePhase: false // SKIPPING INFRA LOOP!
  };
}

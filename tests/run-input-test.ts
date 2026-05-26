import { testerAgent } from "../src/agents/tester/agent.js";
import { Finding, VulnerabilityReport } from "../src/agents/tester/types.js";
import { readFileSync } from "fs";

function mapFindingToReport(finding: Finding, sourceCode: string): VulnerabilityReport {
  const nameMatch = finding.path.match(/([^\/]+)\.sol$/);
  const contractName = nameMatch ? nameMatch[1] : "TargetContract";

  return {
    id: finding.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50),
    severity: finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low",
    type: "custom",
    title: finding.title,
    description: finding.description,
    affectedContract: {
      name: contractName,
      sourceCode: sourceCode,
    },
    attackVector: finding.judgeReview.exploitablePaths[0] || "Unknown vector",
    exploitablePaths: finding.judgeReview.exploitablePaths,
    codeSnippet: finding.codeSnippet,
    location: finding.location
  };
}

async function main() {
  const input = JSON.parse(readFileSync("src/agents/tester/data/input.json", "utf-8"));
  
  // O Finding do auditor já tem o 'codeSnippet', mas para o Oracle precisamos do 'sourceCode' completo.
  // Como não temos o repositório do coder aqui, vamos usar o codeSnippet envolto em um contrato mínimo
  // ou assumir que o codeSnippet é representativo para o teste.
  // Na vida real, o index.ts passa o coderResult.contract.
  
  // Vamos criar um sourceCode fake que contém o snippet para testar o fluxo.
  const fakeSourceCode = `
pragma solidity ^0.8.20;
contract CafeToken {
    mapping(address => uint256) public balances;
    event RewardRedeemed(address indexed user, uint256 amount, string recompensa);
    function _burn(address account, uint256 amount) internal {
        balances[account] -= amount;
    }
    function balanceOf(address account) public view returns (uint256) {
        return balances[account];
    }
    function mint(address account, uint256 amount) public {
        balances[account] += amount;
    }
    ${input.codeSnippet}
}
  `;

  const report = mapFindingToReport(input, fakeSourceCode);

  console.log("Iniciando execução do Agente Tester com input.json...");
  const result = await testerAgent.invoke({ report });

  console.log("\n======= Resultado =======");
  console.log("Status Final:", result.status);
  console.log("Iterações:", result.iterations);
  if (result.lastError) console.log("Último Erro:", result.lastError);
  
  console.log("\n======= Código Gerado =======");
  console.log(result.pocCode);
}

main().catch(console.error);

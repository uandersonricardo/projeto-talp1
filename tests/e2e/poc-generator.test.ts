import { runPoCGenerator } from "../../src/agents/tester/index.js";
import { VulnerabilityReport } from "../../src/agents/tester/types.js";

const VULNERABLE_BANK = `
pragma solidity ^0.8.20;
contract VulnerableBank {
    mapping(address => uint) public balances;
    function deposit() external payable { balances[msg.sender] += msg.value; }
    function withdraw() external {
        uint amount = balances[msg.sender];
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok);
        balances[msg.sender] = 0;  // atualiza DEPOIS — reentrancy
    }
    receive() external payable {}
}`.trim();

const mockReport: VulnerabilityReport = {
  id: "e2e-reentrancy-001",
  severity: "high",
  type: "reentrancy",
  title: "Reentrancy em withdraw()",
  description: "withdraw() envia ETH antes de zerar o saldo, permitindo re-entrada.",
  affectedContract: { name: "VulnerableBank", sourceCode: VULNERABLE_BANK },
  attackVector: "Contrato atacante com fallback() que chama withdraw() novamente antes do saldo ser zerado.",
  suggestedCheatcodes: ["vm.deal", "vm.startPrank", "vm.stopPrank"],
};

async function runE2ETest() {
  console.log("Iniciando smoke test end-to-end (Reentrancy)...");
  
  // Garantir que o sandbox está limpo
  // No mundo real, scripts/setup-sandbox.sh deve ser rodado uma vez no setup do sistema
  
  try {
    const result = await runPoCGenerator(mockReport);

    console.log("\n======= E2E RESULT =======");
    console.log(`Status: ${result.status}`);
    console.log(`Iterações: ${result.iterations}`);
    console.log(`Logs: ${result.executionLogs.length} entrada(s)`);

    console.assert(result.status === "success", `FALHOU: status esperado 'success', recebido '${result.status}'`);
    console.assert(result.solidityCode.includes("test_Exploit"), "FALHOU: código não contém test_Exploit");

    if (result.status === "success") {
        console.log("\nSmoke test PASSOU: Vulnerabilidade confirmada via PoC!");
    } else {
        console.error("\nSmoke test FALHOU: Agente não conseguiu gerar PoC válido.");
    }
  } catch (error) {
    console.error("Erro fatal no teste E2E:", error);
  }
}

runE2ETest().catch(console.error);

import { describe, expect, it } from "vitest";

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

describe("PoC generator (e2e)", () => {
  it("generates a PoC from a vulnerability report", async () => {
    const result = await runPoCGenerator(mockReport);

    expect(result.status).toBe("success");
    expect(result.solidityCode).toContain("test_Exploit");
    expect(result.executionLogs.length).toBeGreaterThan(0);
  }, 120000);
});

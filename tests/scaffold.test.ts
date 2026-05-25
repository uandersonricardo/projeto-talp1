import { describe, expect, it } from "vitest";

import { generateLocalScaffold } from "../src/agents/tester/tools/scaffoldGenerator.js";

describe("generateLocalScaffold", () => {
  it("creates a basic exploit scaffold", () => {
    const mockReport = {
      id: "t1",
      severity: "high" as const,
      type: "reentrancy",
      title: "Reentrancy in withdraw()",
      description: "withdraw() sends ETH before zeroing balance",
      attackVector: "Malicious callback",
      affectedContract: {
        name: "VulnerableBank",
        sourceCode: `
pragma solidity ^0.8.20;
contract VulnerableBank {
  mapping(address=>uint) public balances;
  function withdraw() external {
    uint a = balances[msg.sender];
    (bool ok,) = msg.sender.call{value:a}("");
    require(ok); balances[msg.sender] = 0;
  }
}`,
      },
    };

    const scaffold = generateLocalScaffold(mockReport);

    expect(scaffold).toContain("contract ExploitTest is Test");
    expect(scaffold).toContain("VulnerableBank target");
    expect(scaffold).toContain("function setUp()");
    expect(scaffold).toContain("function test_Exploit()");
  });
});

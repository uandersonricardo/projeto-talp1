import { generateLocalScaffold } from "../src/agents/tester/tools/scaffoldGenerator.js";

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
}`
  }
};

const scaffold = generateLocalScaffold(mockReport);
console.log("--- Scaffold Output ---");
console.log(scaffold);
console.log("--- End Scaffold ---");

console.assert(scaffold.includes("contract ExploitTest is Test"), "Scaffold missing ExploitTest");
console.assert(scaffold.includes("VulnerableBank target"), "Scaffold missing target declaration");
console.assert(scaffold.includes("function setUp()"), "Scaffold missing setUp");
console.assert(scaffold.includes("function test_Exploit()"), "Scaffold missing test_Exploit");

console.log("Scaffold generator test passed");

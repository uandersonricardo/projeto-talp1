import { testerAgent } from "../src/agents/tester/agent.js";

const mockReport = {
  id: "test-stub", 
  severity: "high" as const, 
  type: "reentrancy",
  title: "Test", 
  description: "Test", 
  attackVector: "Test",
  affectedContract: { name: "Test", sourceCode: "pragma solidity ^0.8.0;" }
};

const result = await testerAgent.invoke({ report: mockReport });

console.assert(result.status === "success", `status deve ser success, mas foi ${result.status}`);
console.assert(result.iterations === 1, `iterations deve ser 1, mas foi ${result.iterations}`);

console.log("Grafo stub OK:", result.status);
console.log("Iterations:", result.iterations);

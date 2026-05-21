import { StateGraph, END, START } from "@langchain/langgraph";
import { PoCStateAnnotation, PoCState } from "./state.js";
import { generateLocalScaffold } from "./tools/scaffoldGenerator.js";
import { OracleContext } from "./types.js";

async function oracleNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[oracleNode] gerando scaffold para:", state.report.title);

  const solidityScaffold = generateLocalScaffold(state.report);
  const oracleContext: OracleContext = { solidityScaffold };

  console.log("[oracleNode] scaffold gerado, tamanho:", solidityScaffold.length, "chars");
  return { oracleContext };
}

async function generatePoCNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[generatePoCNode] stub — iteração:", state.iterations);
  return { iterations: 1 };
}

async function runFoundryNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[runFoundryNode] stub");
  return { status: "success" };
}

async function reflectNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[reflectNode] stub");
  return {};
}

const graph = new StateGraph(PoCStateAnnotation)
  .addNode("oracleNode", oracleNode)
  .addNode("generatePoCNode", generatePoCNode)
  .addNode("runFoundryNode", runFoundryNode)
  .addNode("reflectNode", reflectNode)
  .addEdge(START, "oracleNode")
  .addEdge("oracleNode", "generatePoCNode")
  .addEdge("generatePoCNode", "runFoundryNode")
  .addEdge("runFoundryNode", "reflectNode")
  .addEdge("reflectNode", END);

export const testerAgent = graph.compile();

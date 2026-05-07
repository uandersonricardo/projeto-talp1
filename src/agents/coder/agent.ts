import { END, type GraphNode, START, StateGraph } from "@langchain/langgraph";

import { CoderState } from "./state.ts";

const PLACEHOLDER_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Placeholder {
    // TODO: implement contract based on requirements
}`;

const generateContract: GraphNode<typeof CoderState> = async (_state) => {
  return { contract: PLACEHOLDER_CONTRACT };
};

export const coderAgent = new StateGraph(CoderState)
  .addNode("generateContract", generateContract)
  .addEdge(START, "generateContract")
  .addEdge("generateContract", END)
  .compile();

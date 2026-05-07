import { END, type GraphNode, START, StateGraph } from "@langchain/langgraph";

import { TesterState } from "./state.ts";

const runTests: GraphNode<typeof TesterState> = async (_state) => {
  return { results: [] };
};

export const testerAgent = new StateGraph(TesterState)
  .addNode("runTests", runTests)
  .addEdge(START, "runTests")
  .addEdge("runTests", END)
  .compile();

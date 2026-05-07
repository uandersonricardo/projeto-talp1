import { END, type GraphNode, START, StateGraph } from "@langchain/langgraph";

import { AuditorState } from "./state.ts";
import { slitherTool } from "./tools/slither-tool.ts";

const PLACEHOLDER_VULNERABILITIES = [
  { type: "reentrancy", severity: "high", description: "Unchecked external call allows reentrancy attack." },
  { type: "integer-overflow", severity: "medium", description: "Arithmetic operation may overflow." },
];

const auditContract: GraphNode<typeof AuditorState> = async (state) => {
  await slitherTool.invoke({ solidityFile: state.solidityFile });
  return { vulnerabilities: PLACEHOLDER_VULNERABILITIES };
};

export const auditorAgent = new StateGraph(AuditorState)
  .addNode("auditContract", auditContract)
  .addEdge(START, "auditContract")
  .addEdge("auditContract", END)
  .compile();

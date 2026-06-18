import "dotenv/config";
import { testerAgentGraph } from "./graph.js";

// Export the compiled graph as the main agent entrypoint
export const testerAgent = testerAgentGraph;

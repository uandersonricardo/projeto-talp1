import { StateGraph, END, START } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { PoCStateAnnotation, PoCState } from "./state.js";
import { contextNode } from "./nodes/context.js";
import { pocoAgentNode } from "./nodes/pocoAgent.js";
import { pocoTools } from "./tools.js";

// Create the ToolNode
const pocoToolsNode = new ToolNode<PoCState>(pocoTools);

// The conditional router for the ReAct loop
function routeAfterAgent(state: PoCState): "pocoToolsNode" | typeof END {
  // If we hit limits, stop
  if (state.status === "failed" || state.status === "timeout") {
    return END;
  }
  
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  
  // If the LLM made tool calls, route to tools
  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return "pocoToolsNode";
  }
  
  // Otherwise, the LLM has finished its reasoning/execution
  return END;
}

import { emitStep } from "../../logger.js";

// A simple node to update the toolCallCount after tools run
function trackToolCallsNode(state: PoCState): Partial<PoCState> {
  emitStep({ agent: "tester", step: "run", status: "running" });

  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  
  let newStatus = state.status;
  if (lastMessage && lastMessage._getType() === "tool" && lastMessage.name === "smart_contract_test") {
    if (typeof lastMessage.content === "string" && lastMessage.content.includes("Test Passed Successfully!")) {
      newStatus = "success";
    }
  }

  if (newStatus === "success") {
    emitStep({ agent: "tester", step: "run", status: "done" });
    emitStep({ agent: "tester", step: "gen", status: "done" });
  }

  return {
    toolCallCount: 1, // reducer is additive (+1)
    status: newStatus,
  };
}

function routeAfterTools(state: PoCState): "pocoAgentNode" | typeof END {
  if (state.status === "success") {
    return END;
  }
  return "pocoAgentNode";
}

const graphBuilder = new StateGraph(PoCStateAnnotation)
  .addNode("contextNode", contextNode)
  .addNode("pocoAgentNode", pocoAgentNode)
  .addNode("pocoToolsNode", pocoToolsNode)
  .addNode("trackToolCallsNode", trackToolCallsNode)
  
  .addEdge(START, "contextNode")
  .addEdge("contextNode", "pocoAgentNode")
  
  // ReAct Loop Routing
  .addConditionalEdges("pocoAgentNode", routeAfterAgent, {
    pocoToolsNode: "pocoToolsNode",
    [END]: END,
  })
  
  // After tools execute, track the count, then loop back to agent
  .addEdge("pocoToolsNode", "trackToolCallsNode")
  .addConditionalEdges("trackToolCallsNode", routeAfterTools, {
    pocoAgentNode: "pocoAgentNode",
    [END]: END,
  });

export const testerAgentGraph = graphBuilder.compile();

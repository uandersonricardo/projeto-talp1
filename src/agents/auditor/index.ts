import { AIMessage, SystemMessage, type ToolMessage } from "@langchain/core/messages";
import { type ConditionalEdgeRouter, END, type GraphNode, START, StateGraph } from "@langchain/langgraph";
import { model } from "./model";
import { MessagesState } from "./state";
import { searchTool } from "./tools/search-tool";

const modelWithTools = model.bindTools([searchTool]);

const llmCall: GraphNode<typeof MessagesState> = async (state) => {
  return {
    messages: [
      await modelWithTools.invoke([
        new SystemMessage("You are a helpful assistant tasked with performing arithmetic on a set of inputs."),
        ...state.messages,
      ]),
    ],
    llmCalls: 1,
  };
};

const toolNode: GraphNode<typeof MessagesState> = async (state) => {
  const lastMessage = state.messages.at(-1);

  if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
    return { messages: [] };
  }

  const result: ToolMessage[] = [];
  for (const toolCall of lastMessage.tool_calls ?? []) {
    const _toolName = toolCall.name;
    const tool = searchTool;
    const observation = await tool.invoke(toolCall);
    result.push(observation);
  }

  return { messages: result };
};

const shouldContinue: ConditionalEdgeRouter<typeof MessagesState, {}, "toolNode"> = (state) => {
  const lastMessage = state.messages.at(-1);

  // Check if it's an AIMessage before accessing tool_calls
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) {
    return END;
  }

  // If the LLM makes a tool call, then perform an action
  if (lastMessage.tool_calls?.length) {
    return "toolNode";
  }

  // Otherwise, we stop (reply to the user)
  return END;
};

export const agent = new StateGraph(MessagesState)
  .addNode("llmCall", llmCall)
  .addNode("toolNode", toolNode)
  .addEdge(START, "llmCall")
  .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
  .addEdge("toolNode", "llmCall")
  .compile();

import { MessagesValue, ReducedValue, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const MessagesState = new StateSchema({
  messages: MessagesValue,
  llmCalls: new ReducedValue(z.number().default(0), { reducer: (x, y) => x + y }),
});

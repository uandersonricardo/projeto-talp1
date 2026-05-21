import { END, type GraphNode, START, StateGraph } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { CoderState } from "./state.ts";
import { solidityCoderPrompt, solidityFixPrompt, solidityReviewPrompt } from "./prompts.ts";
import { compileSolidityTool } from "./tools/compile-solidity.ts";

const MAX_FIX_ATTEMPTS = 3;

function createLLM() {
  return new ChatGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY || "",
    model: process.env.MODEL_NAME || "gemini-2.5-flash",
    temperature: 0.2,
  });
}

/**
 * Extrai apenas o bloco de código Solidity de uma resposta do LLM.
 */
function extractSolidityCode(text: string): string {
  const match = text.match(/```(?:solidity)?\s*\n([\s\S]*?)```/);
  if (match) return match[1].trim();
  // Se não tem bloco de código, assume que a resposta inteira é código
  return text.trim();
}

/**
 * Nó 1: Gera o smart contract a partir dos requisitos.
 */
const generateContract: GraphNode<typeof CoderState> = async (state) => {
  const llm = createLLM();
  const chain = solidityCoderPrompt.pipe(llm);

  const requirementsText = state.requirements
    .map((r, i) => `${i + 1}. ${r}`)
    .join("\n");

  const result = await chain.invoke({ requirements: requirementsText });
  const code = extractSolidityCode(
    typeof result.content === "string" ? result.content : JSON.stringify(result.content),
  );

  return { contract: code, compilationErrors: [] };
};

/**
 * Nó 2: Compila o contrato e armazena erros (se houver).
 */
const compileContract: GraphNode<typeof CoderState> = async (state) => {
  const result = await compileSolidityTool.invoke({
    sourceCode: state.contract,
    filename: "Contract.sol",
  });

  return { compilationErrors: result.errors };
};

/**
 * Nó 3: Corrige o contrato com base nos erros de compilação.
 */
const fixContract: GraphNode<typeof CoderState> = async (state) => {
  const llm = createLLM();
  const chain = solidityFixPrompt.pipe(llm);

  const errorsText = state.compilationErrors.join("\n\n");

  const result = await chain.invoke({
    contract: state.contract,
    errors: errorsText,
  });

  const code = extractSolidityCode(
    typeof result.content === "string" ? result.content : JSON.stringify(result.content),
  );

  return { contract: code, compilationErrors: [] };
};

/**
 * Nó 4: Revisa o contrato compilado quanto a segurança e boas práticas.
 */
const reviewContract: GraphNode<typeof CoderState> = async (state) => {
  const llm = createLLM();
  const chain = solidityReviewPrompt.pipe(llm);

  const requirementsText = state.requirements.join(", ");

  const result = await chain.invoke({
    requirements: requirementsText,
    contract: state.contract,
  });

  const summary =
    typeof result.content === "string" ? result.content : JSON.stringify(result.content);

  return { reviewSummary: summary };
};

/**
 * Roteador: decide se precisa corrigir ou se pode seguir para revisão.
 * Controla o número de tentativas de correção.
 */
let fixAttempts = 0;

function shouldFix(state: { compilationErrors: string[] }): "fixContract" | "reviewContract" {
  if (state.compilationErrors.length > 0 && fixAttempts < MAX_FIX_ATTEMPTS) {
    fixAttempts++;
    return "fixContract";
  }
  fixAttempts = 0; // reset para próxima execução
  return "reviewContract";
}

export const coderAgent = new StateGraph(CoderState)
  .addNode("generateContract", generateContract)
  .addNode("compileContract", compileContract)
  .addNode("fixContract", fixContract)
  .addNode("reviewContract", reviewContract)
  .addEdge(START, "generateContract")
  .addEdge("generateContract", "compileContract")
  .addConditionalEdges("compileContract", shouldFix)
  .addEdge("fixContract", "compileContract")
  .addEdge("reviewContract", END)
  .compile();

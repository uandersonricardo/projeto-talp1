import { FoundryResult } from "../tools/foundryRunner.js";

export type ErrorCategory =
  | "compiler_error"
  | "revert_no_message"
  | "revert_with_message"
  | "assertion_failed"
  | "timeout"
  | "unknown";

export interface LogAnalysis {
  category: ErrorCategory;
  summary: string;          // 1-2 frases em linguagem natural para o LLM
  relevantLines: string[];  // máx 10 linhas do log original
}

export function analyzeFoundryLog(result: FoundryResult): LogAnalysis {
  if (result.timedOut) return {
    category: "timeout",
    summary: "Forge excedeu 60s. O exploit pode ter entrado em loop infinito ou a lógica está bloqueante.",
    relevantLines: [],
  };

  if (result.combined.includes("Compiler run failed")) {
    const lines = result.combined.split("\n")
      .filter(l => l.includes("Error") || l.includes("error") || l.includes("-->"))
      .slice(0, 10);
    return {
      category: "compiler_error",
      summary: "Erro de compilação Solidity. Verifique: interfaces faltando, assinaturas incorretas, tipos incompatíveis.",
      relevantLines: lines,
    };
  }

  if (result.combined.includes("FAIL")) {
    const revertReason  = result.combined.match(/revert: (.+)/)?.[1];
    const assertionFail = result.combined.includes("Assertion Failed") || result.combined.includes("assertion failed");

    if (assertionFail) return {
      category: "assertion_failed",
      summary: "O exploit executou mas a assertion final falhou — o atacante não obteve o resultado esperado.",
      relevantLines: result.combined.split("\n")
        .filter(l => l.includes("assertion") || l.includes("FAIL")).slice(0, 10),
    };

    if (revertReason) return {
      category: "revert_with_message",
      summary: `Transação reverteu com: "${revertReason}". O contrato rejeitou a operação.`,
      relevantLines: [revertReason],
    };

    return {
      category: "revert_no_message",
      summary: "Transação reverteu sem mensagem. Verifique a ordem das chamadas, permissões e estado do contrato.",
      relevantLines: result.combined.split("\n")
        .filter(l => l.includes("revert") || l.includes("FAIL")).slice(0, 5),
    };
  }

  return {
    category: "unknown",
    summary: "Erro desconhecido. Revisar output completo do forge.",
    relevantLines: result.combined.split("\n").slice(0, 10),
  };
}

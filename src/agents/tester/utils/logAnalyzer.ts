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

/**
 * Extracts the most actionable compiler error lines from forge output.
 * Focuses on the actual error messages and file locations.
 */
function extractCompilerErrors(combined: string): string[] {
  const lines = combined.split("\n");
  const errorLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match actual error lines with file location arrows
    if (line.includes("Error") || line.includes("error[") || line.includes("--> ")) {
      errorLines.push(line);
      // Include next line (context after the arrow) if it exists
      if (lines[i + 1] && (lines[i + 1].includes("|") || lines[i + 1].includes("^"))) {
        errorLines.push(lines[i + 1]);
        if (lines[i + 2] && lines[i + 2].includes("|")) {
          errorLines.push(lines[i + 2]);
        }
      }
    }
    if (errorLines.length >= 30) break;
  }
  
  // Filter out Warning-only lines
  return errorLines.filter(l => !l.trim().startsWith("Warning"));
}

export function analyzeFoundryLog(result: FoundryResult): LogAnalysis {
  if (result.timedOut) return {
    category: "timeout",
    summary: "Forge exceeded 60s. The exploit may have an infinite loop or blocking logic.",
    relevantLines: [],
  };

  if (result.combined.includes("Compiler run failed")) {
    const errorLines = extractCompilerErrors(result.combined);

    // Detect specific compiler error patterns for targeted guidance
    let specificGuidance = "";
    const fullOutput = result.combined;
    
    if (fullOutput.includes("File not found") || fullOutput.includes("Source") && fullOutput.includes("not found")) {
      specificGuidance = " Import path is WRONG — check remappings and use the pattern from existing tests.";
    } else if (fullOutput.includes("Identifier not found") || fullOutput.includes("not visible")) {
      specificGuidance = " Identifier/member not found — check function name, visibility, or declare a minimal interface.";
    } else if (fullOutput.includes("type conversion") || fullOutput.includes("Type") && fullOutput.includes("not implicitly convertible")) {
      specificGuidance = " Type mismatch — add explicit cast.";
    } else if (fullOutput.includes("Function") && fullOutput.includes("not found")) {
      specificGuidance = " Function signature is wrong — check the API reference and use the exact signature.";
    }

    return {
      category: "compiler_error",
      summary: `[COMPILER_ERROR] Solidity compilation failed.${specificGuidance} Check: wrong import paths, missing members, type mismatches. Use the project remappings and existing test import patterns.`,
      relevantLines: errorLines,
    };
  }

  if (result.combined.includes("No tests found")) {
    return {
      category: "unknown",
      summary: "[COMPILER_ERROR] No tests found in ExploitTest. Ensure the contract is named exactly 'ExploitTest' and the test function is 'test_Exploit()'.",
      relevantLines: ["No tests found in ExploitTest"],
    };
  }

  if (result.combined.includes("FAIL")) {
    const revertReason  = result.combined.match(/revert: (.+)/)?.[1];
    const customError   = result.combined.match(/custom error '([^']+)'/)?.[1];
    const assertionFail = result.combined.includes("Assertion Failed") || result.combined.includes("assertion failed");
    const transferFail  = result.combined.includes("TRANSFER_FROM_FAILED") || result.combined.includes("TRANSFER_FAILED");

    if (assertionFail) {
      const assertLines = result.combined.split("\n")
        .filter(l => l.includes("assertion") || l.includes("FAIL") || l.includes("Left") || l.includes("Right"))
        .slice(0, 10);
      return {
        category: "assertion_failed",
        summary: "[ASSERTION_FAILED] The exploit ran but the final assertion failed — the attacker did not achieve the expected outcome. Re-check the exploit logic and expected values.",
        relevantLines: assertLines,
      };
    }

    if (transferFail) return {
      category: "revert_with_message",
      summary: `[REVERT] Token transfer failed (TRANSFER_FROM_FAILED). The contract does not have enough tokens, or approval is missing. Setup token balances and approvals before the exploit.`,
      relevantLines: [result.combined.split("\n").find(l => l.includes("TRANSFER")) ?? "TRANSFER_FROM_FAILED"],
    };

    if (customError) return {
      category: "revert_with_message",
      summary: `[REVERT] Contract reverted with custom error: "${customError}". Check what conditions trigger this error in the contract source.`,
      relevantLines: [customError],
    };

    if (revertReason) return {
      category: "revert_with_message",
      summary: `[REVERT] Transaction reverted with: "${revertReason}". The contract rejected the operation — check permissions, roles, and call order.`,
      relevantLines: [revertReason],
    };

    return {
      category: "revert_no_message",
      summary: "[REVERT_NO_MESSAGE] Transaction reverted without a message. Common causes: wrong call order, missing role/permission setup, incorrect contract state, or wrong function arguments.",
      relevantLines: result.combined.split("\n")
        .filter(l => l.includes("revert") || l.includes("FAIL")).slice(0, 5),
    };
  }

  return {
    category: "unknown",
    summary: "[UNKNOWN_ERROR] Unexpected forge output. Review the full output below.",
    relevantLines: result.combined.split("\n").slice(0, 10),
  };
}

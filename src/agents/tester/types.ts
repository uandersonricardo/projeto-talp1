export interface VulnerabilityReport {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  type: string;
  title: string;
  description: string;
  affectedContract: {
    name: string;
    sourceCode: string;  // Solidity completo, preferencialmente flattened
  };
  attackVector: string;
  suggestedCheatcodes?: string[];
}

export interface OracleContext {
  solidityScaffold: string;  // Exploit.t.sol parcial com setUp() pronto
}

export interface PoCResult {
  reportId: string;
  status: "success" | "failed" | "timeout";
  solidityCode: string;
  executionLogs: string[];
  iterations: number;
}

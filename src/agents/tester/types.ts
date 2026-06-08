export interface Finding {
  title: string;
  description: string;
  recommendation: string;
  severity: "high" | "medium" | "low";
  codeSnippet: string;
  location: string;
  path: string;
  judgeReview: {
    review: string;
    confidence: number;
    exploitablePaths: string[];
  };
}

export interface VulnerabilityReport {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  type: string;
  title: string;
  description: string;
  affectedContract: {
    name: string;
    sourceCode: string;
    sourceFilePath?: string;
  };
  attackVector: string;
  suggestedCheatcodes?: string[];
  codeSnippet?: string;
  location?: string;
  exploitablePaths?: string[];
  customSandboxDir?: string; // Caminho para execução do Forge (opcional)
  referenceTestCode?: string; // Código de um teste existente para referência de setup
}

export interface OracleContext {
  solidityScaffold: string;  // Exploit.t.sol parcial com setUp() pronto
  constructorInfo?: string;  // Assinatura do constructor para ajudar no deploy
  targetContractAPI?: string;  // Resumo dos métodos e variáveis do contrato alvo
  referenceTestHelpers?: string; // Resumo das funções auxiliares disponíveis no ambiente de teste
}

export interface PoCResult {
  reportId: string;
  status: "success" | "failed" | "timeout";
  solidityCode: string;
  executionLogs: string[];
  iterations: number;
}

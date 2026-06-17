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
  patchDiff?: string; // Unified diff of the patch (vulnerable vs patched) for specificity guidance
}



export interface PoCResult {
  reportId: string;
  status: "success" | "failed" | "timeout";
  solidityCode: string;
  executionLogs: string[];
  iterations: number;
}

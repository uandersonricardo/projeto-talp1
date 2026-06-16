export const matchLines = (fileContent: string, codeSnippet: string): string | null => {
  const fileLines = fileContent.split("\n");
  const snippetLines = codeSnippet.split("\n").map((line) => line.trim());

  for (let i = 0; i < fileLines.length; i++) {
    const fileLine = fileLines[i].trim();

    if (fileLine === snippetLines[0]) {
      let snippetIndex = 1;
      const startLine = i + 1;
      let endLine = i + 1;
      let fileIndex = i + 1;

      while (snippetIndex < snippetLines.length && fileIndex < fileLines.length) {
        const currentFileLine = fileLines[fileIndex].trim();

        if (currentFileLine === snippetLines[snippetIndex]) {
          endLine = fileIndex + 1;
          snippetIndex++;
        }

        fileIndex++;
      }

      if (snippetIndex === snippetLines.length) {
        if (startLine === endLine) {
          return `L${startLine}`;
        }

        return `L${startLine}-${endLine}`;
      }
    }
  }

  return null;
};

type ReviewEntry = {
  finding: {
    title: string;
    severity: string;
    location: string;
    description: string;
    codeSnippet: string;
  };
  review: {
    isFalsePositive: boolean;
    confidence: number;
    review: string;
    exploitablePaths: string[];
  };
};

export const buildReviewBlocks = (fileEntries: ReviewEntry[], iterationCount: number): string => {
  const blocks = fileEntries.map(({ finding, review }, i) => {
    const verdict = review.isFalsePositive
      ? `FALSO POSITIVO (confiança: ${review.confidence}/100)`
      : `VERDADEIRO POSITIVO (confiança: ${review.confidence}/100)`;
    const pathsLabel = review.isFalsePositive ? "Razão de Bloqueio" : "Caminhos de Exploração";
    const pathsContent =
      review.exploitablePaths.length > 0
        ? review.exploitablePaths.map((p) => `  - ${p}`).join("\n")
        : "  (nenhum fornecido)";

    return `[Achado ${i + 1}/${fileEntries.length}] ${finding.title}
Severidade: ${finding.severity}
Localização: linhas ${finding.location}
Descrição: ${finding.description}

Código:
\`\`\`solidity
${finding.codeSnippet}
\`\`\`

Veredito do Revisor: ${verdict}
Análise do Revisor: ${review.review}
${pathsLabel}:
${pathsContent}`;
  });

  return `=== Iteração ${iterationCount} — Achados e Revisões do Especialista (${fileEntries.length} achado(s)) ===\n\n${blocks.join("\n\n---\n\n")}`;
};

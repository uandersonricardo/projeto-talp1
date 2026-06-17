import fs from "node:fs";
import path from "node:path";

import { DOC_BASENAMES, DOC_EXTS, MAX_DEPTH, SKIP_DIRS, SOL_EXT, SOL_TEST_SUFFIXES } from "./config.ts";

export const walkDirectory = (dir: string, depth: number, solFiles: string[], docFiles: string[]) => {
  if (depth > MAX_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walkDirectory(path.join(dir, entry.name), depth + 1, solFiles, docFiles);
      }
    } else if (entry.isFile()) {
      const fullPath = path.join(dir, entry.name);
      const ext = path.extname(entry.name).toLowerCase();
      const base = path.basename(entry.name, ext).toLowerCase();

      if (ext === SOL_EXT) {
        const isTest = SOL_TEST_SUFFIXES.some((suffix) => entry.name.endsWith(suffix));
        if (!isTest) solFiles.push(fullPath);
      } else if (DOC_EXTS.has(ext) || DOC_BASENAMES.has(base)) {
        docFiles.push(fullPath);
      }
    }
  }
};

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

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

export const SOL_EXT = ".sol";
export const SOL_TEST_SUFFIXES = [".t.sol", ".test.sol", ".spec.sol"];
export const DOC_EXTS = new Set([".md", ".rst", ".adoc"]);
export const DOC_BASENAMES = new Set(["readme", "whitepaper", "spec", "architecture", "design", "overview", "docs"]);
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "out",
  "artifacts",
  "cache",
  "lib",
  ".deps",
  "build",
  "dist",
  "test",
  "tests",
  "script",
  "scripts",
]);
export const MAX_DEPTH = 6;
export const MAX_DOC_CHARS = 12_000;
export const MAX_SOL_CHARS = 40_000;
export const MAX_REFLECTIONS = 3;

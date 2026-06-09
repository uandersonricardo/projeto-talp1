# PoC Tester Agent — Progress Log

> **Repository:** `uandersonricardo/projeto-talp1`
> **Branch:** `teste_agent`
> **Model used:** `google/gemini-3.1-flash-lite` (via OpenRouter)
> **Framework:** LangGraph + Foundry
> **Dataset:** [ASSERT-KTH/Proof-of-Patch](https://github.com/ASSERT-KTH/Proof-of-Patch) — 22 real-world smart contract vulnerabilities with verified patches

---

## Metric Definitions

| Metric | Formula | Meaning |
|---|---|---|
| **Reproducibility Rate** | `PoCs passing on vulnerable version / 22` | Agent generates a working exploit |
| **Specificity Rate** | `PoCs failing on patched version / reproducible PoCs` | Exploit is logically correct (patch stops it) |
| **Overall Ground Truth** | `reproducible AND specific / 22` | Both conditions satisfied |

> **Reference:** The PoCo paper (Andersson et al., arXiv:2511.02780) evaluated on the same dataset using GPT-4o.
> Cases #003 and #015 have "inconclusive patches" per §5.3.1 — the patch fixes the bug but the PoC still passes because it tests side-effects unaffected by the fix. This is a known dataset limitation.

---

## Benchmark History

### Run 0 — Baseline (before any improvements)
**Date:** 2026-06-07 (pre-session)
**Commit:** `d849e68`

| Metric | Value |
|---|---|
| Reproducibility | **27.3%** (6/22) |
| Specificity | **0.0%** (0/6) |
| Overall Ground Truth | **0.0%** |
| Avg Iterations | 8.18 |

**Reproducible:** 001, 003, 008, 051, 054, 091
**Main failure:** ~63% were COMPILER_ERROR — agent guessing wrong import paths with no context.

---

### Run 1 — Quick validation (5 cases, first improvements)
**Date:** 2026-06-08

| Metric | Value |
|---|---|
| Reproducibility | **20.0%** (1/5) |
| Specificity | **0.0%** |
| Avg Iterations | 8.40 |

---

### Run 2 — Quick validation (5 cases, BFS + minimal interface)
**Date:** 2026-06-08
**Key changes:** BFS test file selection, compileFailures counter, MINIMAL_INTERFACE escape hatch

| Metric | Value |
|---|---|
| Reproducibility | **80.0%** (4/5) |
| Specificity | **0.0%** |
| Avg Iterations | 7.00 |

**Notable:** Case 015: 10 iters → failed became 6 iters → success thanks to MINIMAL_INTERFACE.

---

### Run 3 — Full benchmark (22 cases)
**Date:** 2026-06-08
**Commit:** `1929f1b`

| Metric | Value |
|---|---|
| Reproducibility | **54.5%** (12/22) |
| Specificity | **0.0%** (0/12) |
| Overall Ground Truth | **0.0%** |
| Avg Iterations | 7.55 |

**Reproducible (12):** 001, 003, 008, 015, 032, 051, 054, 058, 066, 077, 091, 098
**Failed (10):** 009, 018, 020, 033, 039, 041, 042, 048, 049, 070
**Error (1):** 046 (forge not in PATH during setup)

**Root cause of specificity=0%:** Patch application was broken — `cp -rv patches/ID/*` copied
a repo-name subdirectory INTO tempPatchDir instead of overwriting the actual source files.
The "patched" version was still running the vulnerable code.

---

## Per-Case Results (Run 3)

| ID | Vuln Type | Project | Repro | Iter | Failure Root Cause |
|---|---|---|---|---|---|
| 001 | multicall | 2024-06-size | ✅ | 9 | Patch not applied (dir bug) |
| 003 | access control | 2023-07-pooltogether | ✅ | 5 | Inconclusive patch (paper §5.3.1) |
| 008 | logic error | 2023-09-centrifuge | ✅ | 2 | Patch not applied (dir bug) |
| 009 | logic error | 2023-10-caviar | ❌ | 10 | `lib/caviar/lib/oracle` missing |
| 015 | access control | 2023-07-pooltogether | ✅ | 5 | Inconclusive patch (paper §5.3.1) |
| 018 | flash loan | 2023-10-caviar | ❌ | 10 | `lib/caviar/lib/oracle` missing |
| 020 | denial of service | 2023-10-dopex | ❌ | 10 | `node_modules/@openzeppelin` missing |
| 032 | access control | 2022-06-putty | ✅ | 4 | Patch not applied (dir bug) |
| 033 | logic error | 2023-10-caviar | ❌ | 10 | `lib/caviar/lib/oracle` missing |
| 039 | unchecked calls | 2024-03-axis-finance | ❌ | 10 | Compiled OK but logic reverted |
| 041 | reentrancy | 2024-03-axis-finance | ❌ | 10 | Compiled OK but logic reverted |
| 042 | access control | 2023-10-cap | ❌ | 10 | `node_modules/@openzeppelin-upgradeable` missing |
| 046 | n/a | n/a | ❌ | — | forge not in PATH (setup script error) |
| 048 | reentrancy | 2023-10-caviar | ❌ | 10 | `lib/caviar/lib/oracle` missing |
| 049 | access control | 2024-01-salty | ❌ | 10 | `test/lib/UserFactory.sol` missing |
| 051 | logic error | 2023-11-panoptic | ✅ | 2 | Patch not applied (dir bug) |
| 054 | logic error | 2024-02-wise-lending | ✅ | 7 | Patch not applied (dir bug) |
| 058 | logic error | 2024-04-renzo | ✅ | 5 | Patch not applied (dir bug) |
| 066 | unchecked calls | 2024-05-munchables | ✅ | 8 | Patch not applied (dir bug) |
| 070 | reentrancy | 2024-08-ph | ❌ | 10 | `node_modules/@prb/test` missing |
| 077 | reentrancy | 2024-07-templegold | ✅ | 8 | Patch not applied (dir bug) |
| 091 | logic error | 2024-08-basin | ✅ | 9 | Patch not applied (dir bug) |
| 098 | reentrancy | 2022-05-cally | ✅ | 2 | Patch not applied (dir bug) |

---

## Improvements Implemented

### 1. `projectContextExtractor.ts` (NEW)
**Problem:** LLM was guessing import paths → 63% COMPILER_ERROR failures.
**Fix:** Before generating PoC, reads `remappings.txt`, `foundry.toml`, and the most import-rich
`.t.sol` test file (BFS across all subdirs, picks file with most import lines).

### 2. `compileFailures` Counter + MINIMAL_INTERFACE Escape Hatch
**Problem:** After 10 failed compile attempts, LLM stuck in loop on wrong imports.
**Fix:** Counter increments per compile failure. After 3 consecutive → switches to
`POC_MINIMAL_INTERFACE_PROMPT` which forbids all external imports and uses inline interfaces.

### 3. Error Context in Fix Prompt
**Problem:** LLM only saw "Import path is WRONG" — not which file.
**Fix:** `analyzeFoundryLog` extracts actual error lines (file path + line number) and surfaces
them at the top of the fix prompt.

### 4. Patch Diff in Analysis Prompt
**Problem:** LLM generating generic assertions passing on both vulnerable and patched versions.
**Fix:** Patch diff (unified diff of vulnerable vs patched contract) included in
`analyzeVulnerabilityNode` with instruction: "assertion must PASS on vulnerable, FAIL on patched."

### 5. `dependencyStubber.ts` (NEW)
**Problem:** 7 cases fail because `lib/caviar/lib/oracle/...` or `node_modules/@openzeppelin/...`
are absent from the sandbox.
**Fix:** Runs `forge build` probe before generation, detects all "Source not found" errors,
creates minimal stub contracts at those exact paths.

### 6. `applyPatchSmart` — Smart Patch Application (CRITICAL for specificity)
**Problem:** `cp -rv patches/ID/*` was copying a repo-name subdirectory INTO `tempPatchDir`.
The "patched" test was running the vulnerable code. This is why specificity was always 0%.
**Fix:** For each `.sol` in the patch dir, strips 1, 2, then 3 path prefix levels to find
matching file in `tempPatchDir` and copies it correctly.

```
Patch file: patches/003/2023-07-pooltogether/vault/src/Vault.sol
tempPatchDir: copy of findings/003/2023-07-pooltogether/vault/

strip=1: vault/src/Vault.sol → NOT in tempPatchDir
strip=2: src/Vault.sol → EXISTS ✅ → copy applied
```

### 7. `computePatchDiff` — Correct Diff Calculation
**Problem:** Previous diff command tried a hardcoded path that didn't match the nested structure.
**Fix:** Uses same strip-depth logic as `applyPatchSmart` to find the right file pair.

### 8. Improved Prompts
- `ANALYZE_VULNERABILITY_PROMPT`: asks for specific assertion that fails after patching
- `POC_COMPILE_FIX_PROMPT`: import resolution hierarchy (remappings → existing test → inline)
- `POC_TEST_FIX_PROMPT`: added reentrancy `receive()` callback pattern + unchecked return pattern
- `POC_MINIMAL_INTERFACE_PROMPT` (NEW): full template for zero-external-import strategy

---

## Agent Architecture

```
VulnerabilityReport
       │
       ▼
  oracleNode
  ├── generateLocalScaffold()
  ├── analyzeSolidityFile()           ← contract API extraction
  ├── extractProjectContext()          ← remappings + best .t.sol (BFS)
  └── createMissingDependencyStubs()   ← stubs missing lib/node_modules
       │
       ▼
  analyzeVulnerabilityNode            ← LLM: root cause + specific assertion
  [ANALYZE_VULNERABILITY_PROMPT + patch diff]
       │
       ▼
  generatePoCNode ←──────────────────────────┐
  ├── INITIAL: [POC_INITIAL_PROMPT]           │
  ├── FIX_COMPILE (failures < 3):             │
  │   [POC_COMPILE_FIX_PROMPT]               │
  ├── MINIMAL_INTERFACE (failures >= 3):      │
  │   [POC_MINIMAL_INTERFACE_PROMPT]          │
  └── FIX_LOGIC: [POC_TEST_FIX_PROMPT]       │
       │                                      │
       ▼                                      │
  runFoundryNode → analyzeFoundryLog          │
       │                                      │
       ├── success ──────────────────── END   │
       │                                      │
       └── failed + iters < 10 → reflectNode ─┘
```

---

## Next Steps

### P0 — Run benchmark with patch fix + dep stubs (Run 4)
Expected: Reproducibility ~68%, Specificity ~30%, Ground Truth ~20%

### P1 — Add `refineSpecificityNode`
If PoC passes on both versions, run a refinement step:
- Show: current PoC + patch diff
- Ask: "Make the assertion target exactly what the patch changes"

### P2 — Docker update
The Dockerfile builds TypeScript, so new files are included automatically.
Fix needed: `setup-sandbox.sh` may not find `forge` in Docker because foundryup
sets PATH in `~/.bashrc` (not sourced in non-interactive shells). Fix: add
`source ~/.foundry/env` or `export PATH="$HOME/.foundry/bin:$PATH"` explicitly.

### P3 — Integration check
The tester agent's public API (`VulnerabilityReport → { status, solidityCode }`) is unchanged.
The server.ts route calling `runPoCGenerator()` still works.
Docker image needs rebuild after code changes.

---

## Expected Run 4 Results

| Metric | Run 3 | Target Run 4 |
|---|---|---|
| Reproducibility | 54.5% | ~68% |
| Specificity | 0.0% | ~30% |
| Overall Ground Truth | 0.0% | ~20% |
| Avg Iterations | 7.55 | <7.0 |


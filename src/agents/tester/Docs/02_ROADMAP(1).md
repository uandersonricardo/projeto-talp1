# Agente Gerador de PoCs — Plano de Implementação (Roadmap)

**Projeto:** TALP1 — CIn/UFPE  
**Agente:** Agente Gerador de PoCs  
**Responsável:** Tales Vinicius Alves da Cunha  

---

## Visão Geral das Fases

| Fase | Tema | Semana | Critério de Conclusão |
|------|------|--------|----------------------|
| 1 | Setup, Estado & Oracle | Semana 1 | Grafo linear roda com stubs; `oracleNode` gera scaffold que compila com `forge build` |
| 2 | LLM + Foundry + Loop ReAct | Semana 2 | Pipeline completo roda: LLM gera → Foundry executa → loop corrige ao menos 1 erro |
| 3 | Integração, Smoke Test & Avaliação | Semana 3 | PoC de reentrancy passa end-to-end; taxa de sucesso medida em ≥5 casos do benchmark |

---

## Semana 1 — Setup, Estado & Oracle

**Objetivo:** Ter o grafo LangGraph rodando com o Oracle funcional.

### Tasks
- **Task 1.1** — Inicializar o projeto TypeScript (tsconfig, dependências LangGraph, Foundry local)
- **Task 1.2** — Definir o estado do agente (`PoCStateAnnotation`) e interfaces (`VulnerabilityReport`, `PoCResult`)
- **Task 1.3** — Criar nodes stub e grafo linear (sem LLM ainda)
- **Task 1.4** — Implementar `scaffoldGenerator` (gera `setUp()` com deploy local do contrato vítima)
- **Task 1.5** — Implementar `oracleNode` (integra `stateInitializer` + `scaffoldGenerator`)

**Gate:** `oracleNode` recebe um `VulnerabilityReport` fake e retorna scaffold que passa em `forge build`

---

## Semana 2 — LLM + Foundry + Loop ReAct

**Objetivo:** Pipeline completo rodando com loop de correção.

### Tasks
- **Task 2.1** — Criar o system prompt (`prompts/system.ts`)
- **Task 2.2** — Implementar `extractSolidity` (parser do output do LLM)
- **Task 2.3** — Implementar `generatePoCNode` (chamada LLM + retry em caso de bloco Solidity inválido)
- **Task 2.4** — Setup do sandbox Foundry em `/tmp/poc-sandbox/`
- **Task 2.5** — Implementar `foundryRunner` (executa `forge test -vvvv` via `child_process`, retorna output estruturado)
- **Task 2.6** — Implementar `logAnalyzer` (classifica erros: compilation / assertion / timeout)
- **Task 2.7** — Implementar `reflectNode` (LLM analisa logs e produz feedback estruturado)
- **Task 2.8** — Implementar `routeAfterFoundry` (router condicional: pass → END, fail → reflect → generate)

**Gate:** Agente faz ≥2 iterações completas e melhora o código após erro de compilação

---

## Semana 3 — Integração, Smoke Test & Avaliação

**Objetivo:** Pipeline validado end-to-end com métricas.

### Tasks
- **Task 3.1** — Definir interface pública (`runPoCGenerator`)
- **Task 3.2** — Smoke test com reentrancy simples (contrato vítima hardcoded)
- **Task 3.3** — Preparar `benchmark.json` com ≥5 casos do dataset Proof-of-Patch (ASSERT-KTH)
- **Task 3.4** — Implementar `evaluate.ts` (roda agente em batch, coleta status/iterations/logs)

**Gate:** PoC de reentrancy passa end-to-end; taxa de sucesso medida e documentada

---

## Critérios de Conclusão (GATES)

| Semana | Critério de Conclusão |
|--------|------------------------------|
| Semana 1 | `oracleNode` gera scaffold que compila sozinho com `forge build` |
| Semana 2 | Loop ReAct faz ≥2 iterações e produz correção após erro |
| Semana 3 | PoC de reentrancy passa end-to-end; benchmark com ≥5 casos executado |

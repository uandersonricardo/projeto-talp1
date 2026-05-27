# Agente Gerador de PoCs — Arquitetura e Fluxo de Dados

**Projeto:** TALP1 — CIn/UFPE  
**Agente:** Agente Gerador de PoCs  
**Responsável:** Tales Vinicius Alves da Cunha  
**Stack:** TypeScript · Node.js · LangGraph · Foundry  

---

## 1. Visão Geral

O Agente Gerador de PoCs recebe um relatório de vulnerabilidade estruturado (JSON) do Agente Auditor e produz automaticamente um exploit em Solidity verificado pelo Foundry. O agente executa um **loop ReAct**: gerar → executar → refletir → repetir, até que o exploit passe nos testes ou o limite de iterações seja atingido.

Diferente de abordagens de "mainnet fork", este agente foca em **simulação local controlada** (abordagem inspirada no PoCo — Bergman et al., KTH 2025), onde o ambiente é montado do zero para cada ataque.

> **Diferencial em relação ao PoCo:** o PoCo deixava o LLM escrever o `setUp()` do Foundry livremente, o que gerava erros frequentes de instanciação. Este agente introduz o **Oracle** como camada dedicada de preparação do ambiente, fornecendo um scaffold com deploy automático do contrato vítima — o LLM foca exclusivamente na lógica do exploit.

---

## 2. Posição no Sistema Multi-agente

```
Requisitos (PDF/MD)
      │
      ▼
┌─────────────────────┐
│  Agente Gerador     │  ── Compiler, RAG
│  de Código          │
└──────────┬──────────┘
           │ Repositório Solidity
           ▼
┌─────────────────────┐
│  Agente Auditor     │  ── Slither, AST
└──────────┬──────────┘
           │ Relatório de Vulnerabilidades (JSON)
           ▼
┌─────────────────────┐
│  Agente Gerador     │  ── Local Oracle, Foundry   ◄─── você está aqui
│  de PoCs            │
└──────────┬──────────┘
           │ Exploit.t.sol (Projeto Solidity)
           ▼
      Projeto Final
```

---

## 3. Arquitetura Interna do Agente

### 3.1 Fluxo Principal (grafo LangGraph)

```
                    ┌─────────────────────────────────┐
                    │         ESTADO DO AGENTE         │
                    │  report · oracleContext · pocCode │
                    │  executionLogs · lastError        │
                    │  iterations · status              │
                    └─────────────────────────────────┘

Auditor Report (JSON)
        │
        ▼
┌───────────────────┐
│   oracleNode      │   ← Preparação do ambiente: gera o setup inicial local
└────────┬──────────┘
         │ OracleContext (scaffold Solidity com deploy local da vítima)
         ▼
┌───────────────────┐         ┌──────────────────────┐
│  generatePoCNode  │ ◄───────│     reflectNode       │
│  (LLM + prompts)  │         │  (análise de logs)    │
└────────┬──────────┘         └──────────▲────────────┘
         │ Solidity code                 │ feedback estruturado
         ▼                               │ (categoria de erro + resumo)
┌───────────────────┐    FAIL / ERROR    │
│  runFoundryNode   │────────────────────┘
│  (forge test -vvvv)│
└────────┬──────────┘
         │
    ┌────┴────┐
  PASS      FAIL (≥5 iterações ou timeout)
    │              │
    ▼              ▼
  END            END
(success)      (failed)
```

---

## 4. O Oracle — O Que É e Por Que Existe

### 4.1 Contexto

No contexto deste agente, o Oracle é um **gerador de ambiente de teste**. Ao invés de buscar dados na blockchain real, ele prepara um "sandbox" local onde o contrato vulnerável é implantado e financiado automaticamente.

### 4.2 Problema que o Oracle resolve

O LLM muitas vezes tem dificuldade em escrever a função `setUp()` do Foundry porque não sabe como instanciar o contrato vítima ou dar saldo ao atacante. O Oracle resolve isso fornecendo um **scaffold (template)** pronto, permitindo que o LLM foque exclusivamente na lógica do exploit.

### 4.3 Os 2 sub-tools do Oracle

```
oracleNode
    │
    ├── 1. stateInitializer      → Define saldos e condições iniciais (ex: 100 ETH para a vítima)
    │
    └── 2. scaffoldGenerator     → Gera o Exploit.t.sol com o deploy do contrato e setUp() pronto
                                   Retorna: string (código Solidity parcial)
```

---

## 5. Fluxo de Dados Completo (entrada → saída)

### 5.1 Input: VulnerabilityReport (do Agente Auditor)

```typescript
interface VulnerabilityReport {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  type: string;
  title: string;
  description: string;
  affectedContract: {
    name: string;
    sourceCode: string;   // código Solidity completo (preferencialmente flattened)
  };
  attackVector: string;
  suggestedCheatcodes?: string[];
}
```

### 5.2 Output: PoCResult

```typescript
interface PoCResult {
  reportId: string;
  status: "success" | "failed" | "timeout";
  solidityCode: string;    // conteúdo final do Exploit.t.sol
  executionLogs: string[];
  iterations: number;
}
```

---

## 6. Estrutura de Arquivos

```
src/agents/poc-generator/
├── agent.ts                    # grafo LangGraph, nodes, roteamento
├── state.ts                    # PoCStateAnnotation
│
├── tools/
│   ├── scaffoldGenerator.ts   # Oracle sub-tool (gera template local)
│   └── foundryRunner.ts        # executa forge test via child_process
│
├── prompts/
│   └── system.ts               # system prompt do LLM gerador
│
└── utils/
    ├── extractSolidity.ts      # parser do output do LLM
    └── logAnalyzer.ts          # classifica erros do forge
```

---

## 7. Variáveis de Ambiente

```env
OPENROUTER_API_KEY=...     # chave do LLM
```

---

## 8. Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| LLM reescreve o scaffold ao invés de completar | System prompt proíbe explicitamente modificar `setUp()`; validação pós-extração |
| Contrato vítima tem muitas dependências | Auditor deve fornecer código "flattened"; Oracle lida com imports locais no sandbox |
| LLM não gera bloco Solidity válido | `extractSolidity` lança erro; `generatePoCNode` captura e retenta |
| Timeout no Foundry | Limite de 60s por execução; análise de loops infinitos no `logAnalyzer` |

---

## 9. Base Acadêmica

- **PoCo** (Bergman et al., KTH 2025) — framework agêntico para geração de PoC exploits em smart contracts. Artefatos: `ASSERT-KTH/PoCo-public`
- **Proof-of-Patch** (ASSERT-KTH) — dataset de 23 vulnerabilidades reais (2022–2025) com patches correspondentes, usado como benchmark de avaliação

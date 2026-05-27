# Agente Gerador de PoCs — Tasks (formato Jira)

**Projeto:** TALP1 — CIn/UFPE  
**Agente:** Agente Gerador de PoCs  
**Responsável:** Tales Vinicius Alves da Cunha  
**Stack:** TypeScript · Node.js · LangGraph · Foundry  

---

## SEMANA 1 — Setup, Estado & Oracle

---

### TALP-1.1 — Inicializar o projeto TypeScript

| Campo | Valor |
|-------|-------|
| **Tipo** | Setup |
| **Prioridade** | Crítica |
| **Estimativa** | 1h |
| **Depende de** | — |

**Descrição**  
Criar a estrutura base do projeto TypeScript com todas as dependências necessárias para rodar o agente LangGraph com Foundry.

**Arquivos a criar**
```
src/agents/poc-generator/          ← criar diretório
tsconfig.json                      ← criar na raiz
package.json                       ← atualizar
```

**Setup**
```bash
mkdir -p src/agents/poc-generator/tools
mkdir -p src/agents/poc-generator/prompts
mkdir -p src/agents/poc-generator/utils
mkdir -p tests/e2e
mkdir -p scripts
mkdir -p data

npm install @langchain/langgraph @langchain/openai zod
npm install -D typescript ts-node @types/node
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "node16",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true
  }
}
```

**Critérios de aceitação**
- [ ] `npx tsc --noEmit` roda sem erros em um arquivo vazio em `src/agents/poc-generator/agent.ts`
- [ ] Todas as dependências aparecem no `package.json`
- [ ] Estrutura de diretórios criada conforme acima

**Como testar**
```bash
npx tsc --noEmit        # deve sair com código 0
ls src/agents/poc-generator/tools/    # deve existir
```

---

### TALP-1.2 — Definir interfaces e estado do agente

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Crítica |
| **Estimativa** | 2h |
| **Depende de** | TALP-1.1 |

**Descrição**  
Criar os tipos TypeScript que definem o contrato de dados do agente: o que entra (`VulnerabilityReport`), o que sai (`PoCResult`), e o estado interno do grafo LangGraph (`PoCStateAnnotation`).

**Arquivos a criar**
```
src/agents/poc-generator/types.ts    ← interfaces de input/output
src/agents/poc-generator/state.ts    ← PoCStateAnnotation (LangGraph)
```

**Implementação — `types.ts`**
```typescript
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
```

**Implementação — `state.ts`**
```typescript
import { Annotation } from "@langchain/langgraph";
import { VulnerabilityReport, OracleContext } from "./types";

export const PoCStateAnnotation = Annotation.Root({
  report: Annotation<VulnerabilityReport>(),

  oracleContext: Annotation<OracleContext | null>({
    default: () => null,
    reducer: (_, y) => y,           // overwrite — preenchido 1x pelo oracleNode
  }),

  pocCode: Annotation<string>({
    default: () => "",
    reducer: (_, y) => y,           // overwrite — sempre a versão mais recente
  }),

  executionLogs: Annotation<string[]>({
    default: () => [],
    reducer: (x, y) => x.concat(y), // append — nunca perde logs anteriores
  }),

  lastError: Annotation<string | null>({
    default: () => null,
    reducer: (_, y) => y,           // overwrite — última análise de erro
  }),

  iterations: Annotation<number>({
    default: () => 0,
    reducer: (x, y) => x + y,       // aditivo — incrementado em +1 por chamada
  }),

  status: Annotation<"running" | "success" | "failed" | "timeout">({
    default: () => "running",
    reducer: (_, y) => y,           // overwrite
  }),
});

export type PoCState = typeof PoCStateAnnotation.State;
```

**Critérios de aceitação**
- [ ] `npx tsc --noEmit` passa sem erros
- [ ] `iterations` usa reducer aditivo (não overwrite)
- [ ] `executionLogs` usa reducer de append (nunca trunca histórico)
- [ ] `oracleContext` usa overwrite mas default é `null`
- [ ] Todos os campos têm `default` e `reducer` definidos

**Como testar**
```bash
npx tsc --noEmit
```
Criar arquivo de teste manual `tests/state.test.ts`:
```typescript
import { PoCStateAnnotation } from "../src/agents/poc-generator/state";
const s = PoCStateAnnotation.spec;
console.assert(s.iterations !== undefined, "iterations deve existir");
console.log("Estado OK");
```

---

### TALP-1.3 — Criar nodes stub e grafo linear

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Crítica |
| **Estimativa** | 2h |
| **Depende de** | TALP-1.2 |

**Descrição**  
Criar o grafo LangGraph com quatro nodes stub (sem lógica real ainda) conectados linearmente. Objetivo: validar que o grafo compila, executa e passa o estado corretamente entre os nodes.

**Arquivos a criar/modificar**
```
src/agents/poc-generator/agent.ts    ← criar
```

**Implementação**
```typescript
import { StateGraph, END, START } from "@langchain/langgraph";
import { PoCStateAnnotation, PoCState } from "./state";

async function oracleNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[oracleNode] stub — report recebido:", state.report.id);
  return {};
}

async function generatePoCNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[generatePoCNode] stub — iteração:", state.iterations);
  return { iterations: 1 };
}

async function runFoundryNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[runFoundryNode] stub");
  return { status: "success" };
}

async function reflectNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[reflectNode] stub");
  return {};
}

const graph = new StateGraph(PoCStateAnnotation)
  .addNode("oracleNode", oracleNode)
  .addNode("generatePoCNode", generatePoCNode)
  .addNode("runFoundryNode", runFoundryNode)
  .addNode("reflectNode", reflectNode)
  .addEdge(START, "oracleNode")
  .addEdge("oracleNode", "generatePoCNode")
  .addEdge("generatePoCNode", "runFoundryNode")
  .addEdge("runFoundryNode", END);

export const pocGeneratorAgent = graph.compile();
```

**Critérios de aceitação**
- [ ] `pocGeneratorAgent.invoke({ report: mockReport })` executa sem erros
- [ ] Console exibe os 4 nomes de nodes em ordem correta
- [ ] Estado final tem `status: "success"` e `iterations: 1`
- [ ] `npx tsc --noEmit` passa

**Como testar**
```typescript
// tests/stub-run.ts
import { pocGeneratorAgent } from "../src/agents/poc-generator/agent";
const mockReport = {
  id: "test-stub", severity: "high" as const, type: "reentrancy",
  title: "Test", description: "Test", attackVector: "Test",
  affectedContract: { name: "Test", sourceCode: "pragma solidity ^0.8.0;" }
};
const result = await pocGeneratorAgent.invoke({ report: mockReport });
console.assert(result.status === "success", "status deve ser success");
console.assert(result.iterations === 1, "iterations deve ser 1");
console.log("Grafo stub OK:", result.status);
```
```bash
npx ts-node tests/stub-run.ts
```

---

### TALP-1.4 — Implementar `scaffoldGenerator`

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Crítica |
| **Estimativa** | 3h |
| **Depende de** | TALP-1.2 |

**Descrição**  
Implementar a função que gera o scaffold Solidity com `setUp()` pronto. O LLM receberá este arquivo parcial e precisará completar apenas a função `test_Exploit()`. Isso elimina o erro mais comum do PoCo: o LLM instanciar o contrato vítima de forma incorreta.

**Arquivos a criar**
```
src/agents/poc-generator/tools/scaffoldGenerator.ts
```

**Implementação**
```typescript
import { VulnerabilityReport } from "../types";

export function generateLocalScaffold(report: VulnerabilityReport): string {
  const cheatcodes = report.suggestedCheatcodes?.join(", ") ?? "vm.deal, vm.prank, vm.warp";

  return `// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/console.sol";

// ── Código-fonte do contrato vulnerável ──────────────────────────────────────
${report.affectedContract.sourceCode}
// ─────────────────────────────────────────────────────────────────────────────

contract ExploitTest is Test {
    ${report.affectedContract.name} target;
    address constant ATTACKER = address(0xBEEF);

    // setUp() gerado automaticamente pelo Oracle — NÃO MODIFICAR
    function setUp() public {
        target = new ${report.affectedContract.name}();
        vm.deal(address(target), 100 ether);
        vm.deal(ATTACKER, 10 ether);
        vm.label(address(target), "TARGET");
        vm.label(ATTACKER, "ATTACKER");
    }

    // Vulnerabilidade: ${report.title}
    // Tipo: ${report.type}
    // Vetor: ${report.attackVector}
    // Cheatcodes sugeridos: ${cheatcodes}
    //
    // COMPLETE APENAS ESTA FUNÇÃO — não altere setUp() nem os campos acima
    function test_Exploit() public {
        vm.startPrank(ATTACKER);
        // TODO: implementar exploit aqui
        vm.stopPrank();
    }
}`.trim();
}
```

**Critérios de aceitação**
- [ ] Output é Solidity sintaticamente válido (passa `forge build`)
- [ ] `setUp()` inclui `vm.deal` para target (100 ETH) e ATTACKER (10 ETH)
- [ ] Comentários indicam claramente o que o LLM deve completar
- [ ] `suggestedCheatcodes` aparece no scaffold quando presentes no report
- [ ] Contrato vítima é incluído inline (sem imports externos)

**Como testar**
```bash
# 1. Gerar o scaffold manualmente
npx ts-node -e "
import { generateLocalScaffold } from './src/agents/poc-generator/tools/scaffoldGenerator';
const scaffold = generateLocalScaffold({
  id:'t1', severity:'high', type:'reentrancy', title:'Reentrancy em withdraw()',
  description:'...', attackVector:'callback malicioso',
  affectedContract: { name: 'VulnerableBank', sourceCode: \`
pragma solidity ^0.8.20;
contract VulnerableBank {
  mapping(address=>uint) public balances;
  function deposit() external payable { balances[msg.sender] += msg.value; }
  function withdraw() external {
    uint a = balances[msg.sender];
    (bool ok,) = msg.sender.call{value:a}('');
    require(ok); balances[msg.sender] = 0;
  }
}\`}
});
console.log(scaffold);
" > /tmp/poc-sandbox/test/Exploit.t.sol

# 2. Verificar compilação
cd /tmp/poc-sandbox && forge build
```

---

### TALP-1.5 — Implementar `oracleNode`

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Crítica |
| **Estimativa** | 1h |
| **Depende de** | TALP-1.3, TALP-1.4 |

**Descrição**  
Substituir o stub do `oracleNode` pela implementação real que chama o `scaffoldGenerator` e persiste o resultado no estado.

**Arquivos a modificar**
```
src/agents/poc-generator/agent.ts    ← substituir stub do oracleNode
```

**Implementação**
```typescript
import { generateLocalScaffold } from "./tools/scaffoldGenerator";

async function oracleNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[oracleNode] gerando scaffold para:", state.report.title);

  const solidityScaffold = generateLocalScaffold(state.report);
  const oracleContext: OracleContext = { solidityScaffold };

  console.log("[oracleNode] scaffold gerado, tamanho:", solidityScaffold.length, "chars");
  return { oracleContext };
}
```

**Critérios de aceitação**
- [ ] `oracleContext` não é mais `null` após a execução do node
- [ ] Scaffold gerado passa `forge build` sem erros de compilação
- [ ] Não há chamadas de rede, RPC ou I/O externo neste node
- [ ] Log mostra o título do report e o tamanho do scaffold

**Gate da Semana 1:** Rodar o grafo stub com um `VulnerabilityReport` fake e verificar que `oracleContext.solidityScaffold` compila com `forge build`.

```bash
# Teste do gate
npx ts-node tests/stub-run.ts
# Copiar o scaffold para o sandbox e compilar
cd /tmp/poc-sandbox && forge build
```

---

## SEMANA 2 — LLM + Foundry + Loop ReAct

---

### TALP-2.1 — Criar o system prompt

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Alta |
| **Estimativa** | 2h |
| **Depende de** | TALP-1.4 |

**Descrição**  
Criar o system prompt que instrui o LLM a agir como pesquisador de segurança Solidity. O prompt precisa garantir: (1) output é apenas Solidity em bloco, (2) o LLM não reescreve o `setUp()`, (3) toda linha não-óbvia tem comentário.

**Arquivos a criar**
```
src/agents/poc-generator/prompts/system.ts
```

**Implementação**
```typescript
export const SYSTEM_PROMPT = `Você é um Pesquisador de Segurança Solidity especializado em escrever exploits Proof of Concept (PoC) para Foundry.

## TAREFA
Você receberá:
1. Um relatório de vulnerabilidade descrevendo uma falha de segurança em Solidity.
2. Um scaffold Foundry parcialmente completo com setUp() já implementado.

Sua missão: completar APENAS a função test_Exploit() — e, se necessário, adicionar contratos auxiliares (ex: atacante com fallback()) ANTES do contrato ExploitTest.

## RESTRIÇÕES ABSOLUTAS
- NÃO modifique setUp(), imports, constants ou qualquer campo marcado com "NÃO MODIFICAR".
- NÃO adicione novos imports além dos já presentes.
- Output APENAS um bloco \`\`\`solidity ... \`\`\` com o arquivo completo. Sem texto fora do bloco.

## REGRAS DE QUALIDADE
- Use cheatcodes Foundry quando necessário: vm.warp(), vm.roll(), vm.prank(), vm.deal(), vm.expectRevert().
- A assertion final DEVE usar assertTrue(), assertGt() ou assertEq() para provar que o exploit teve sucesso.
- Cada linha não-óbvia DEVE ter um comentário inline explicando por que existe.
- Se precisar de flash loan, implemente o callback do provider já configurado no setUp().
- Se não conseguir completar o exploit, implemente o máximo possível e adicione comentários // TODO: explicando o que falta.

## FORMATO DE OUTPUT
\`\`\`solidity
// arquivo completo aqui
\`\`\`
`.trim();
```

**Critérios de aceitação**
- [ ] LLM sempre produz um bloco ` ```solidity``` ` no output (validar em ≥5 chamadas manuais)
- [ ] LLM nunca reescreve `setUp()` (testar com prompt de retry)
- [ ] LLM sempre inclui pelo menos uma assertion no `test_Exploit()`
- [ ] Prompt cabe em menos de 500 tokens (verificar com `tiktoken`)

**Como testar**
```typescript
// Teste manual: chamar o LLM diretamente com o system prompt
import { ChatOpenAI } from "@langchain/openai";
import { SYSTEM_PROMPT } from "./src/agents/poc-generator/prompts/system";
const llm = new ChatOpenAI({ modelName: "gpt-4o", openAIApiKey: process.env.OPENROUTER_API_KEY });
const resp = await llm.invoke([
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: "Scaffold: ...\nVulnerabilidade: reentrancy simples" }
]);
console.log(resp.content);
// Verificar manualmente: contém ```solidity```? Não modificou setUp()?
```

---

### TALP-2.2 — Implementar `extractSolidity`

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Alta |
| **Estimativa** | 1h |
| **Depende de** | TALP-2.1 |

**Descrição**  
Parser robusto que extrai o bloco Solidity do output do LLM, com fallbacks para casos onde o modelo omite os backticks.

**Arquivos a criar**
```
src/agents/poc-generator/utils/extractSolidity.ts
```

**Implementação**
```typescript
export function extractSolidity(llmOutput: string): string {
  // Caso 1: bloco ```solidity ... ``` padrão
  const match = llmOutput.match(/```solidity\s*([\s\S]*?)```/);
  if (match) return match[1].trim();

  // Caso 2: LLM omitiu backticks mas começa com pragma/SPDX
  const trimmed = llmOutput.trim();
  if (trimmed.startsWith("// SPDX") || trimmed.startsWith("pragma")) {
    return trimmed;
  }

  // Caso 3: output inválido — lançar erro descritivo
  throw new Error(
    `LLM output não contém bloco Solidity válido. Preview: "${llmOutput.slice(0, 200)}"`
  );
}
```

**Critérios de aceitação**
- [ ] Extrai corretamente de bloco ` ```solidity``` ` padrão
- [ ] Usa fallback quando LLM omite backticks mas começa com `pragma` ou `// SPDX`
- [ ] Lança `Error` descritivo quando output é texto puro sem Solidity
- [ ] Resultado nunca contém os backticks do bloco

**Como testar**
```typescript
// tests/unit/extractSolidity.test.ts
import { extractSolidity } from "../../src/agents/poc-generator/utils/extractSolidity";

// Caso 1: bloco padrão
const r1 = extractSolidity("Aqui está:\n```solidity\npragma solidity ^0.8.0;\n```");
console.assert(r1 === "pragma solidity ^0.8.0;", "Caso 1 falhou");

// Caso 2: sem backticks
const r2 = extractSolidity("pragma solidity ^0.8.0;\ncontract A {}");
console.assert(r2.startsWith("pragma"), "Caso 2 falhou");

// Caso 3: inválido — deve lançar
try {
  extractSolidity("Desculpe, não consigo gerar isso.");
  console.error("Caso 3 deveria ter lançado erro!");
} catch (e) {
  console.log("Caso 3 OK — erro lançado:", (e as Error).message.slice(0, 50));
}

console.log("Todos os testes de extractSolidity passaram");
```

---

### TALP-2.3 — Implementar `generatePoCNode`

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Crítica |
| **Estimativa** | 3h |
| **Depende de** | TALP-2.1, TALP-2.2 |

**Descrição**  
Substituir o stub por um node real que chama o LLM. O prompt do usuário muda dependendo se é a primeira tentativa (passa o scaffold) ou um retry (passa o código com erro anterior).

**Arquivos a modificar**
```
src/agents/poc-generator/agent.ts    ← substituir stub do generatePoCNode
```

**Implementação**
```typescript
import { ChatOpenAI } from "@langchain/openai";
import { SYSTEM_PROMPT } from "./prompts/system";
import { extractSolidity } from "./utils/extractSolidity";

const llm = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.2,
  openAIApiKey: process.env.OPENROUTER_API_KEY,
  configuration: { baseURL: "https://openrouter.ai/api/v1" },
});

async function generatePoCNode(state: PoCState): Promise<Partial<PoCState>> {
  const { report, oracleContext, executionLogs, pocCode, iterations, lastError } = state;
  const isRetry = iterations > 0;

  const userMessage = isRetry
    ? `O seguinte exploit FALHOU no Foundry.

Código anterior:
\`\`\`solidity
${pocCode}
\`\`\`

Output do Forge (última execução):
${executionLogs[executionLogs.length - 1]?.slice(0, 3000) ?? "sem logs"}

Análise do erro: ${lastError ?? "desconhecido"}

Corrija o código. Retorne o arquivo Solidity completo corrigido.`
    : `Relatório de Vulnerabilidade:
- Título: ${report.title}
- Tipo: ${report.type}
- Descrição: ${report.description}
- Vetor de Ataque: ${report.attackVector}

Scaffold (complete APENAS test_Exploit):
\`\`\`solidity
${oracleContext!.solidityScaffold}
\`\`\``;

  console.log(`[generatePoCNode] iteração ${iterations + 1}, isRetry=${isRetry}`);

  try {
    const response = await llm.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);
    const solidityCode = extractSolidity(response.content as string);
    console.log("[generatePoCNode] Solidity extraído, tamanho:", solidityCode.length);
    return { pocCode: solidityCode, iterations: 1 };
  } catch (err) {
    console.error("[generatePoCNode] falha na extração:", (err as Error).message);
    return { iterations: 1, lastError: `Falha ao extrair Solidity: ${(err as Error).message}` };
  }
}
```

**Critérios de aceitação**
- [ ] Na primeira iteração: passa scaffold completo + descrição da vulnerabilidade
- [ ] No retry: passa código anterior + logs do forge + análise do erro
- [ ] `iterations` incrementa em +1 a cada chamada (via reducer aditivo)
- [ ] Erro de extração não trava o grafo — registra `lastError` e continua
- [ ] Logs do forge são truncados a 3000 chars (evitar ultrapassar context window)

---

### TALP-2.4 — Setup do sandbox Foundry

| Campo | Valor |
|-------|-------|
| **Tipo** | Setup/Infra |
| **Prioridade** | Crítica |
| **Estimativa** | 1h |
| **Depende de** | TALP-1.1 |

**Descrição**  
Criar script de inicialização do sandbox Foundry local em `/tmp/poc-sandbox/`. O agente escreve o arquivo `Exploit.t.sol` aqui e executa `forge test`.

**Arquivos a criar**
```
scripts/setup-sandbox.sh
foundry.toml                         ← copiado para o sandbox
```

**Implementação — `setup-sandbox.sh`**
```bash
#!/bin/bash
set -e

SANDBOX="/tmp/poc-sandbox"

echo "Inicializando sandbox Foundry em $SANDBOX..."
rm -rf "$SANDBOX"
mkdir -p "$SANDBOX"
cd "$SANDBOX"

forge init --no-git --quiet
forge install foundry-rs/forge-std --no-git --quiet

cat > foundry.toml << 'EOF'
[profile.default]
src = "src"
test = "test"
out = "out"
libs = ["lib"]
solc-version = "0.8.20"
EOF

# Remover o contrato e teste de exemplo do forge init
rm -f src/Counter.sol test/Counter.t.sol

echo "Sandbox pronto. Testando com forge build..."
forge build
echo "OK — sandbox funcionando em $SANDBOX"
```

**Critérios de aceitação**
- [ ] Script roda sem erros em máquina com Foundry instalado (`forge --version`)
- [ ] `forge build` dentro de `/tmp/poc-sandbox` tem sucesso após o script
- [ ] Diretório `test/` existe e está vazio (pronto para receber `Exploit.t.sol`)
- [ ] `forge-std` instalado corretamente (import `"forge-std/Test.sol"` funciona)

**Como testar**
```bash
chmod +x scripts/setup-sandbox.sh
./scripts/setup-sandbox.sh
echo "// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;
import 'forge-std/Test.sol';
contract SmokeTest is Test {
  function test_ok() public { assertTrue(true); }
}" > /tmp/poc-sandbox/test/Smoke.t.sol
cd /tmp/poc-sandbox && forge test
```

---

### TALP-2.5 — Implementar `foundryRunner`

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Crítica |
| **Estimativa** | 2h |
| **Depende de** | TALP-2.4 |

**Descrição**  
Módulo que escreve o código Solidity no sandbox, executa `forge test` via `child_process` e retorna o resultado estruturado. Nunca lança erro — sempre retorna `FoundryResult`.

**Arquivos a criar**
```
src/agents/poc-generator/tools/foundryRunner.ts
```

**Implementação**
```typescript
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile } from "fs/promises";

const execAsync  = promisify(exec);
const SANDBOX    = "/tmp/poc-sandbox";
const TIMEOUT_MS = 60_000;

export interface FoundryResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
  timedOut: boolean;
}

export async function runFoundry(solidityCode: string): Promise<FoundryResult> {
  // Escrever o arquivo no sandbox
  await writeFile(`${SANDBOX}/test/Exploit.t.sol`, solidityCode, "utf-8");

  try {
    const { stdout, stderr } = await execAsync(
      "forge test --match-contract ExploitTest -vvvv",
      { cwd: SANDBOX, timeout: TIMEOUT_MS, env: { ...process.env } }
    );
    return {
      exitCode: 0,
      stdout,
      stderr,
      combined: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
      timedOut: false,
    };
  } catch (err: any) {
    if (err.killed || err.signal === "SIGTERM") {
      return {
        exitCode: -1, stdout: "", stderr: "Forge timed out",
        combined: `TIMEOUT após ${TIMEOUT_MS / 1000}s`,
        timedOut: true,
      };
    }
    return {
      exitCode: err.code ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      combined: `STDOUT:\n${err.stdout ?? ""}\nSTDERR:\n${err.stderr ?? ""}`,
      timedOut: false,
    };
  }
}
```

**Critérios de aceitação**
- [ ] Detecta test pass: `exitCode === 0` + stdout contém `"ok"`
- [ ] Detecta compiler error: `exitCode !== 0` + stderr contém `"Compiler run failed"`
- [ ] Detecta timeout: `timedOut === true`, processo morto após 60s
- [ ] Nunca lança exceção — sempre retorna `FoundryResult`
- [ ] `combined` contém stdout e stderr separados por label

**Como testar**
```typescript
// tests/unit/foundryRunner.test.ts
import { runFoundry } from "../../src/agents/poc-generator/tools/foundryRunner";

// Caso 1: código válido que passa
const validCode = `// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;
import "forge-std/Test.sol";
contract ExploitTest is Test {
  function setUp() public {}
  function test_Exploit() public { assertTrue(true); }
}`;
const r1 = await runFoundry(validCode);
console.assert(r1.exitCode === 0, "Deveria passar");
console.assert(r1.stdout.includes("ok"), "Deveria ter 'ok' no stdout");

// Caso 2: código com erro de compilação
const invalidCode = `pragma solidity ^0.8.20; contract Bad { function foo( }`;
const r2 = await runFoundry(invalidCode);
console.assert(r2.exitCode !== 0, "Deveria falhar");
console.assert(r2.stderr.includes("Error") || r2.combined.includes("Error"), "Deveria ter erro");

console.log("foundryRunner OK");
```

---

### TALP-2.6 — Implementar `logAnalyzer`

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Alta |
| **Estimativa** | 2h |
| **Depende de** | TALP-2.5 |

**Descrição**  
Módulo que lê o output bruto do `forge test` e produz um resumo legível em linguagem natural para o LLM. Classifica o erro em uma de 5 categorias.

**Arquivos a criar**
```
src/agents/poc-generator/utils/logAnalyzer.ts
```

**Implementação**
```typescript
import { FoundryResult } from "../tools/foundryRunner";

export type ErrorCategory =
  | "compiler_error"
  | "revert_no_message"
  | "revert_with_message"
  | "assertion_failed"
  | "timeout"
  | "unknown";

export interface LogAnalysis {
  category: ErrorCategory;
  summary: string;          // 1-2 frases em linguagem natural para o LLM
  relevantLines: string[];  // máx 10 linhas do log original
}

export function analyzeFoundryLog(result: FoundryResult): LogAnalysis {
  if (result.timedOut) return {
    category: "timeout",
    summary: "Forge excedeu 60s. O exploit pode ter entrado em loop infinito ou a lógica está bloqueante.",
    relevantLines: [],
  };

  if (result.combined.includes("Compiler run failed")) {
    const lines = result.combined.split("\n")
      .filter(l => l.includes("Error") || l.includes("error") || l.includes("-->"))
      .slice(0, 10);
    return {
      category: "compiler_error",
      summary: "Erro de compilação Solidity. Verifique: interfaces faltando, assinaturas incorretas, tipos incompatíveis.",
      relevantLines: lines,
    };
  }

  if (result.combined.includes("FAIL")) {
    const revertReason  = result.combined.match(/revert: (.+)/)?.[1];
    const assertionFail = result.combined.includes("Assertion Failed") || result.combined.includes("assertion failed");

    if (assertionFail) return {
      category: "assertion_failed",
      summary: "O exploit executou mas a assertion final falhou — o atacante não obteve o resultado esperado.",
      relevantLines: result.combined.split("\n")
        .filter(l => l.includes("assertion") || l.includes("FAIL")).slice(0, 10),
    };

    if (revertReason) return {
      category: "revert_with_message",
      summary: `Transação reverteu com: "${revertReason}". O contrato rejeitou a operação.`,
      relevantLines: [revertReason],
    };

    return {
      category: "revert_no_message",
      summary: "Transação reverteu sem mensagem. Verifique a ordem das chamadas, permissões e estado do contrato.",
      relevantLines: result.combined.split("\n")
        .filter(l => l.includes("revert") || l.includes("FAIL")).slice(0, 5),
    };
  }

  return {
    category: "unknown",
    summary: "Erro desconhecido. Revisar output completo do forge.",
    relevantLines: result.combined.split("\n").slice(0, 10),
  };
}
```

**Critérios de aceitação**
- [ ] Classifica `compiler_error` quando stderr contém `"Compiler run failed"`
- [ ] Classifica `assertion_failed` quando stdout contém `"FAIL"` + `"Assertion Failed"`
- [ ] Classifica `revert_with_message` quando há `revert: <mensagem>`
- [ ] `relevantLines` nunca tem mais de 10 linhas
- [ ] `summary` é sempre linguagem natural (não reproduz stack trace bruto)

**Como testar**
```typescript
// tests/unit/logAnalyzer.test.ts
import { analyzeFoundryLog } from "../../src/agents/poc-generator/utils/logAnalyzer";

const compilerError = { exitCode: 1, timedOut: false, stdout: "", stderr: "Compiler run failed\nError: ...\n--> src/A.sol:10:5", combined: "STDOUT:\n\nSTDERR:\nCompiler run failed\nError: ...\n--> src/A.sol:10:5" };
const r1 = analyzeFoundryLog(compilerError as any);
console.assert(r1.category === "compiler_error", "Caso 1 falhou");
console.assert(r1.relevantLines.length <= 10, "Muitas linhas");

const timeout = { exitCode: -1, timedOut: true, stdout: "", stderr: "", combined: "TIMEOUT" };
const r2 = analyzeFoundryLog(timeout as any);
console.assert(r2.category === "timeout", "Caso timeout falhou");

console.log("logAnalyzer OK");
```

---

### TALP-2.7 — Implementar `reflectNode`

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Alta |
| **Estimativa** | 2h |
| **Depende de** | TALP-2.6 |

**Descrição**  
Node que usa o `logAnalyzer` para produzir um `lastError` estruturado e legível. Este valor é passado para o `generatePoCNode` no retry, orientando o LLM sobre o que corrigir.

**Arquivos a modificar**
```
src/agents/poc-generator/agent.ts    ← substituir stub do reflectNode
```

**Implementação**
```typescript
import { analyzeFoundryLog } from "./utils/logAnalyzer";

async function reflectNode(state: PoCState): Promise<Partial<PoCState>> {
  // Pegar o último log de execução
  const lastLog = state.executionLogs[state.executionLogs.length - 1];
  if (!lastLog) {
    return { lastError: "Sem logs disponíveis para análise." };
  }

  // Reconstruir FoundryResult mínimo a partir do log combinado
  const mockResult = {
    exitCode: 1, timedOut: lastLog.includes("TIMEOUT"),
    stdout: "", stderr: "", combined: lastLog,
  };

  const analysis = analyzeFoundryLog(mockResult as any);

  console.log(`[reflectNode] categoria: ${analysis.category}`);
  console.log(`[reflectNode] resumo: ${analysis.summary}`);

  return {
    lastError: `[${analysis.category.toUpperCase()}] ${analysis.summary}\n\nLinhas relevantes:\n${analysis.relevantLines.join("\n")}`,
  };
}
```

**Critérios de aceitação**
- [ ] `lastError` sempre é uma string não-vazia após o node
- [ ] `lastError` inclui a categoria do erro entre colchetes
- [ ] `lastError` inclui as linhas relevantes do log (não o log inteiro)
- [ ] Node não trava se `executionLogs` estiver vazio

---

### TALP-2.8 — Implementar router condicional e fechar o loop

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Crítica |
| **Estimativa** | 2h |
| **Depende de** | TALP-2.3, TALP-2.5, TALP-2.7 |

**Descrição**  
Substituir as edges fixas do grafo por edges condicionais que implementam o loop ReAct. Atualizar o `runFoundryNode` real e conectar tudo.

**Arquivos a modificar**
```
src/agents/poc-generator/agent.ts    ← refatorar grafo completo
```

**Implementação**
```typescript
const MAX_ITERATIONS = 5;

function routeAfterFoundry(state: PoCState): "reflectNode" | "__end__" {
  if (state.status === "success") return "__end__";
  if (state.status === "timeout") return "__end__";
  if (state.iterations >= MAX_ITERATIONS) return "__end__";
  return "reflectNode";
}

async function runFoundryNode(state: PoCState): Promise<Partial<PoCState>> {
  const result   = await runFoundry(state.pocCode);
  const analysis = analyzeFoundryLog(result);
  const passed   = result.exitCode === 0 && result.stdout.includes("ok");

  console.log(`[runFoundryNode] exitCode=${result.exitCode}, passed=${passed}`);

  return {
    executionLogs: [result.combined],   // reducer append
    lastError: analysis.summary,
    status: passed          ? "success"
          : result.timedOut ? "timeout"
          : "running",
  };
}

// Grafo final com loop ReAct
const graph = new StateGraph(PoCStateAnnotation)
  .addNode("oracleNode",       oracleNode)
  .addNode("generatePoCNode",  generatePoCNode)
  .addNode("runFoundryNode",   runFoundryNode)
  .addNode("reflectNode",      reflectNode)
  .addEdge(START, "oracleNode")
  .addEdge("oracleNode", "generatePoCNode")
  .addEdge("generatePoCNode", "runFoundryNode")
  .addConditionalEdges("runFoundryNode", routeAfterFoundry, {
    reflectNode: "reflectNode",
    __end__: END,
  })
  .addEdge("reflectNode", "generatePoCNode");  // fecha o loop

export const pocGeneratorAgent = graph.compile();
```

**Critérios de aceitação**
- [ ] Loop executa ≥2 iterações quando a primeira tentativa falha
- [ ] Para em `END` quando `status === "success"`
- [ ] Para em `END` quando `iterations >= 5` (mesmo sem sucesso)
- [ ] Para em `END` quando `status === "timeout"`
- [ ] `executionLogs` tem uma entrada por iteração ao final

**Gate da Semana 2:** Rodar o agente com o `VulnerableBank` e confirmar que o loop executa ≥2 iterações e melhora o código após erro de compilação.

---

## SEMANA 3 — Integração, Smoke Test & Avaliação

---

### TALP-3.1 — Interface pública do agente

| Campo | Valor |
|-------|-------|
| **Tipo** | Implementação |
| **Prioridade** | Alta |
| **Estimativa** | 1h |
| **Depende de** | TALP-2.8 |

**Descrição**  
Criar o entry point público que o restante do sistema (Agente Auditor) usará para invocar o Agente de PoCs.

**Arquivos a criar**
```
src/agents/poc-generator/index.ts
```

**Implementação**
```typescript
import { pocGeneratorAgent } from "./agent";
import { VulnerabilityReport, PoCResult } from "./types";

export async function runPoCGenerator(report: VulnerabilityReport): Promise<PoCResult> {
  console.log(`[runPoCGenerator] iniciando para: ${report.id} — ${report.title}`);

  const finalState = await pocGeneratorAgent.invoke({ report });

  const result: PoCResult = {
    reportId:      report.id,
    status:        finalState.status === "running" ? "failed" : finalState.status,
    solidityCode:  finalState.pocCode,
    executionLogs: finalState.executionLogs,
    iterations:    finalState.iterations,
  };

  console.log(`[runPoCGenerator] concluído — status=${result.status}, iterações=${result.iterations}`);
  return result;
}

export type { VulnerabilityReport, PoCResult };
```

**Critérios de aceitação**
- [ ] Nunca lança exceção — retorna `PoCResult` em qualquer cenário
- [ ] `status` nunca é `"running"` no resultado final (mapeia para `"failed"`)
- [ ] Tipos exportados batem com o contrato esperado pelo Agente Auditor

---

### TALP-3.2 — Smoke test end-to-end com reentrancy

| Campo | Valor |
|-------|-------|
| **Tipo** | Teste |
| **Prioridade** | Crítica |
| **Estimativa** | 3h |
| **Depende de** | TALP-3.1 |

**Descrição**  
Validar o pipeline completo com um contrato vulnerável simples de reentrancy escrito manualmente. Este teste não depende de dataset externo.

**Arquivos a criar**
```
tests/e2e/poc-generator.test.ts
```

**Implementação**
```typescript
import { runPoCGenerator } from "../../src/agents/poc-generator";
import { VulnerabilityReport } from "../../src/agents/poc-generator/types";

const VULNERABLE_BANK = `
pragma solidity ^0.8.20;
contract VulnerableBank {
    mapping(address => uint) public balances;
    function deposit() external payable { balances[msg.sender] += msg.value; }
    function withdraw() external {
        uint amount = balances[msg.sender];
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok);
        balances[msg.sender] = 0;  // atualiza DEPOIS — reentrancy
    }
    receive() external payable {}
}`.trim();

const mockReport: VulnerabilityReport = {
  id: "e2e-reentrancy-001",
  severity: "critical",
  type: "reentrancy",
  title: "Reentrancy em withdraw()",
  description: "withdraw() envia ETH antes de zerar o saldo, permitindo re-entrada.",
  affectedContract: { name: "VulnerableBank", sourceCode: VULNERABLE_BANK },
  attackVector: "Contrato atacante com fallback() que chama withdraw() novamente antes do saldo ser zerado.",
  suggestedCheatcodes: ["vm.deal", "vm.startPrank", "vm.stopPrank"],
};

async function runE2ETest() {
  console.log("Iniciando smoke test end-to-end...");
  const result = await runPoCGenerator(mockReport);

  console.log(`Status: ${result.status}`);
  console.log(`Iterações: ${result.iterations}`);
  console.log(`Logs: ${result.executionLogs.length} entrada(s)`);

  console.assert(result.status === "success",    `FALHOU: status esperado 'success', recebido '${result.status}'`);
  console.assert(result.iterations <= 5,          `FALHOU: muitas iterações (${result.iterations})`);
  console.assert(result.solidityCode.includes("test_Exploit"), "FALHOU: código não contém test_Exploit");

  console.log("Smoke test PASSOU");
  return result;
}

runE2ETest().catch(console.error);
```

**Critérios de aceitação**
- [ ] `result.status === "success"`
- [ ] `result.iterations <= 5`
- [ ] `result.solidityCode` contém `test_Exploit`
- [ ] Teste completo roda em menos de 3 minutos
- [ ] Não requer variável `MAINNET_RPC_URL` (contrato é local)

**Como executar**
```bash
OPENROUTER_API_KEY=sk-... npx ts-node tests/e2e/poc-generator.test.ts
```

---

### TALP-3.3 — Preparar dataset de benchmark

| Campo | Valor |
|-------|-------|
| **Tipo** | Dados |
| **Prioridade** | Alta |
| **Estimativa** | 3h |
| **Depende de** | — |

**Descrição**  
Selecionar ≥5 casos reais do dataset **Proof-of-Patch** (ASSERT-KTH) e montar o `benchmark.json`. Priorizar: reentrancy, access control bypass, integer overflow.

**Arquivos a criar**
```
data/benchmark.json
```

**Formato**
```json
[
  {
    "id": "bench-001",
    "vulnerability": "Reentrancy em withdraw()",
    "type": "reentrancy",
    "severity": "critical",
    "contractName": "VulnerableBank",
    "sourceCode": "pragma solidity ^0.8.20; ...",
    "attackVector": "Contrato atacante com fallback reentrant",
    "source": "Proof-of-Patch / ASSERT-KTH",
    "referencePoC": "disponível no repositório ASSERT-KTH/Proof-of-Patch"
  }
]
```

**Critérios de aceitação**
- [ ] ≥5 entradas com `sourceCode` completo e compilável
- [ ] Cobre pelo menos 3 tipos de vulnerabilidade diferentes
- [ ] Cada entrada tem `attackVector` descrito
- [ ] Todos os contratos compilam com `forge build` (verificar antes de incluir)

---

### TALP-3.4 — Script de avaliação em batch

| Campo | Valor |
|-------|-------|
| **Tipo** | Avaliação |
| **Prioridade** | Alta |
| **Estimativa** | 2h |
| **Depende de** | TALP-3.1, TALP-3.3 |

**Descrição**  
Script que roda o agente sobre todos os casos do benchmark e reporta a taxa de sucesso. Um caso que falha não interrompe o batch.

**Arquivos a criar**
```
scripts/evaluate.ts
data/eval-results.json    ← gerado pelo script
```

**Implementação**
```typescript
import { readFileSync, writeFileSync } from "fs";
import { runPoCGenerator } from "../src/agents/poc-generator";

interface BenchmarkCase {
  id: string; vulnerability: string; type: string; severity: string;
  contractName: string; sourceCode: string; attackVector: string;
}

interface EvalResult {
  id: string; status: string; iterations: number;
  passed: boolean; durationMs: number;
}

async function main() {
  const dataset: BenchmarkCase[] = JSON.parse(readFileSync("data/benchmark.json", "utf-8"));
  const results: EvalResult[] = [];

  console.log(`Iniciando avaliação — ${dataset.length} caso(s)\n`);

  for (const item of dataset) {
    const start = Date.now();
    console.log(`[${item.id}] Rodando: ${item.vulnerability}...`);

    try {
      const result = await runPoCGenerator({
        id: item.id, severity: item.severity as any, type: item.type,
        title: item.vulnerability, description: item.vulnerability,
        affectedContract: { name: item.contractName, sourceCode: item.sourceCode },
        attackVector: item.attackVector,
      });
      const dur = Date.now() - start;
      results.push({ id: item.id, status: result.status, iterations: result.iterations, passed: result.status === "success", durationMs: dur });
      console.log(`  → ${result.status} em ${result.iterations} iter(s), ${(dur/1000).toFixed(1)}s`);
    } catch (err) {
      const dur = Date.now() - start;
      results.push({ id: item.id, status: "error", iterations: 0, passed: false, durationMs: dur });
      console.error(`  → ERRO: ${(err as Error).message}`);
    }
  }

  const passed     = results.filter(r => r.passed).length;
  const total      = results.length;
  const successRate = ((passed / total) * 100).toFixed(1);
  const avgIter    = (results.reduce((s, r) => s + r.iterations, 0) / total).toFixed(1);

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Taxa de sucesso: ${successRate}% (${passed}/${total})`);
  console.log(`Média de iterações: ${avgIter}`);
  console.log(`${"=".repeat(40)}`);

  writeFileSync("data/eval-results.json", JSON.stringify({ summary: { successRate: parseFloat(successRate), passed, total, avgIterations: parseFloat(avgIter) }, results }, null, 2));
  console.log("\nResultados salvos em data/eval-results.json");
}

main().catch(console.error);
```

**Critérios de aceitação**
- [ ] Roda todos os casos sem travar (erro individual registrado e continua)
- [ ] Gera `data/eval-results.json` com resultados por caso + sumário
- [ ] Reporta taxa de sucesso, total de casos e média de iterações
- [ ] **Taxa alvo:** ≥50% de sucesso nos casos do benchmark

**Como executar**
```bash
OPENROUTER_API_KEY=sk-... npx ts-node scripts/evaluate.ts
```

---

## Resumo de Arquivos por Task

| Task | Arquivo | Ação |
|------|---------|------|
| TALP-1.1 | `tsconfig.json`, `package.json` | criar/atualizar |
| TALP-1.2 | `src/.../types.ts`, `src/.../state.ts` | criar |
| TALP-1.3 | `src/.../agent.ts` | criar (stubs) |
| TALP-1.4 | `src/.../tools/scaffoldGenerator.ts` | criar |
| TALP-1.5 | `src/.../agent.ts` | modificar (oracleNode real) |
| TALP-2.1 | `src/.../prompts/system.ts` | criar |
| TALP-2.2 | `src/.../utils/extractSolidity.ts` | criar |
| TALP-2.3 | `src/.../agent.ts` | modificar (generatePoCNode real) |
| TALP-2.4 | `scripts/setup-sandbox.sh`, `foundry.toml` | criar |
| TALP-2.5 | `src/.../tools/foundryRunner.ts` | criar |
| TALP-2.6 | `src/.../utils/logAnalyzer.ts` | criar |
| TALP-2.7 | `src/.../agent.ts` | modificar (reflectNode real) |
| TALP-2.8 | `src/.../agent.ts` | modificar (grafo final com loop) |
| TALP-3.1 | `src/.../index.ts` | criar |
| TALP-3.2 | `tests/e2e/poc-generator.test.ts` | criar |
| TALP-3.3 | `data/benchmark.json` | criar |
| TALP-3.4 | `scripts/evaluate.ts` | criar |

# PoCo Agent (Proof-of-Concept Agent)

Este diretório contém a implementação principal do **Agente PoCo**, uma arquitetura autônoma baseada no framework **LangGraph**, desenvolvida para atuar como um auditor de segurança e desenvolvedor de exploits (Proof of Concepts) em Smart Contracts.

## 1. Visão Geral

O Agente recebe como entrada um relatório de vulnerabilidade (escrito por um auditor humano) e o código-fonte do contrato afetado. O objetivo do agente é explorar iterativamente o ambiente local usando o framework **Foundry** até conseguir escrever um arquivo `Exploit.t.sol` que prove matematicamente que a vulnerabilidade descrita é explorável (roubando fundos, burlando acessos, etc).

Diferente de scripts sequenciais convencionais, este agente emprega um **Loop ReAct** (Raciocínio e Ação) iterativo:
1. **Lê e entende** o contexto.
2. **Planeja** uma estratégia de ataque em múltiplos passos.
3. **Escreve** o código no disco.
4. **Compila e testa** localmente via terminal.
5. **Analisa o erro** de compilação ou de lógica e auto-corrige o exploit na próxima iteração.

## 2. Componentes da Arquitetura

O sistema é orquestrado através de uma Máquina de Estados Finita (Graph) no `graph.ts`, composta por 5 nós fundamentais:

*   **`contextNode`**: Nó de entrada. Carrega o relatório original do auditor e injeta no estado global do agente.
*   **`routerNode`**: Formata as restrições do ambiente e monta o `System Prompt` que define a persona do LLM.
*   **`pocoAgentNode`**: O motor cognitivo. Utiliza o modelo de linguagem avançado (ex: Claude 3.5 Sonnet) para raciocinar sobre as falhas e escolher qual ferramenta invocar.
*   **`pocoToolsNode`**: O executor mecânico das ferramentas. Acessa o FileSystem (`read_file`, `write_file`) e o terminal (`smart_contract_test`, `smart_contract_compile`).
*   **`trackToolCallsNode`**: Intercepta a saída do teste. Se o teste passar (`Test Passed Successfully!`), ele interrompe o grafo prematuramente definindo o status de `success`. Se falhar, devolve o feedback de erro para o `pocoAgentNode` tentar novamente, até o limite de 30 iterações.

## 3. Estrutura de Diretórios

```text
src/agents/tester/
├── index.ts           # Entrypoint da biblioteca, orquestra e dispara o grafo LangGraph.
├── agent.ts           # Definição e wrapper do agente para integração externa.
├── graph.ts           # A topologia da rede ReAct (nodes e edges).
├── state.ts           # Interface de Estado global que trafega entre os nós do grafo.
├── types.ts           # Tipagens TypeScript (Report, Vulnerability, etc).
├── tools/             # (Depreciado) Ferramentas antigas de suporte.
├── utils/             # Scripts utilitários e stubs de dependências.
└── nodes/
    ├── context.ts     # Setup inicial e parser do contexto.
    ├── router.ts      # Montagem do prompt base.
    └── pocoAgent.ts   # Chamada direta à API do LLM com as Tools associadas.
```

## 4. Como Executar

O agente não é chamado isoladamente pelo usuário, mas sim invocado pelo orquestrador principal de Benchmark ou pela CLI da ferramenta. Para avaliar a eficácia do agente, recomenda-se executar os scripts do Benchmark na raiz do projeto:

```bash
# Executa a avaliação em cima do dataset Hard (Proof-of-Patch)
DEBUG_CONTEXT=true FORCE_RERUN=true npx tsx src/benchmark/runTesterBenchmark.ts 100
```

## 5. Ferramentas (Tools)

A maestria do agente vem de seu arsenal de ferramentas (`tools.ts`), que operam com alta precisão cirúrgica para economizar tokens:
*   `read_file`, `list_dir`: Explorar a árvore de contratos vulneráveis.
*   `todo_planner`: Criar uma lista de tarefas persistente para orientar a memória de longo prazo durante as 30 iterações.
*   `write_file`, `edit_file`: Gerar ou alterar partes específicas do exploit de forma isolada.
*   `smart_contract_compile`, `smart_contract_test`: Interagir diretamente com a CLI do `forge` para compilar ou rodar os testes, com os logs canalizados de volta para o agente.

> **Nota Metodológica:** O agente assume que está operando em um repositório configurado e funcional. Se as dependências do repositório alvo (ex: submódulos do foundry) estiverem quebradas ou faltantes fisicamente no disco, o agente tentará alucinar "Mocks" arquiteturais para forçar o projeto a compilar, o que foge do escopo do teste da vulnerabilidade. Sempre garanta que o projeto alvo passa por um `forge build` limpo antes de submetê-lo à auditoria.

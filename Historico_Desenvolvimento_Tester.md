# Histórico de Desenvolvimento: Agente Tester

Este documento consolida a evolução da arquitetura do **Agente Gerador de PoCs (Tester)**, mapeando como ele evoluiu de um simples gerador de código para um agente autônomo complexo.

---

## v1.0 - Implementação Base e Grafo Linear
* **Commits base:** `b6cd2805`, `21e1e333`
* **Arquitetura Inicial:** O agente foi concebido como um simples StateGraph linear. Ele recebia o relatório do Auditor, passava para um LLM que gerava o código do teste (`generatePoCNode`), e retornava o código.
* **Limitações:** Não havia execução real do código, logo, a maior parte dos testes gerados falhava por erros de sintaxe ou de importação se fossem rodados na vida real.

---

## v2.0 - O Oráculo e Execução em Loop
* **Commits base:** `0adaeb16`, `29b9e2b4`
* **Introdução do Oráculo (`oracleNode`):** Criamos a primeira versão do Oráculo, responsável por pré-processar o contrato alvo e criar um "Scaffold" (um esqueleto do arquivo de teste com a função `setUp()` e assinaturas de deploy corretas).
* **O Loop Foundry (`runFoundryNode` & `reflectNode`):** O agente deixou de ser "one-shot" e passou a rodar em loop. O código gerado era salvo em um ambiente isolado (sandbox), executado via `forge test`, e a saída bruta era devolvida ao LLM caso o teste falhasse. 
* **Prompts:** Nesta fase, havia essencialmente um único prompt genérico: "Escreva o teste. Se falhar, conserte baseado no erro".
* **Resultados Iniciais no Benchmark:** Ao testar no dataset real, o agente não passava de **27%** de sucesso. A maior parte das falhas ocorria porque o LLM ficava preso em um loop infinito tentando consertar erros de `File not found` (dependências faltando) repetindo o mesmo erro.

---

## v3.0 - Roteamento de Erros e Minimal Interface
* **Commits base:** `1929f1bf`
* **Evolução do Prompt:** Percebeu-se que pedir para o LLM "consertar o erro" sem contexto não funcionava. O `generatePoCNode` foi reescrito para utilizar diferentes "modos de prompt" dependendo do tipo de falha detectada pelo `logAnalyzer`.
  * **`INITIAL`**: Cria o teste.
  * **`FIX_COMPILE`**: Prompt focado estritamente em resolver erros de sintaxe e dependência.
  * **`FIX_LOGIC`**: Prompt focado em resolver reverts na EVM (`assert` falhando, `setUp` incorreto). Foram adicionados padrões comuns (ex: avisar ao LLM sobre callbacks de reentrância ou a necessidade de checar retornos boleanos).
* **Escape Hatch (`MINIMAL_INTERFACE`):** A maior inovação desta versão. Se o agente detectasse 3 falhas seguidas de compilação, ele ativava este modo. O prompt instruía o LLM a apagar *todos* os imports de repositório e injetar interfaces `interface IERC20 {...}` cruas diretamente no arquivo.
* **Resultado:** O agente quebrou o platô e saltou para **45%** de sucesso, provando que contornar erros de compilação era a chave.

---

## v4.0 - Contexto de Repositório e Dependency Stubbing
* **Commits base:** `4b0ab735`
* **O Problema da Especificidade:** Observamos que o agente tinha **0% de Specificity Rate** no benchmark. Descobriu-se que o script bash não estava aplicando o patch de correção corretamente no repositório. Criamos a função `applyPatchSmart` para corrigir isso, e passamos o `patchDiff` real para o LLM.
* **O Problema do Contexto Cego:** O agente estava falhando em projetos complexos porque usava imports incorretos. 
  * Criamos o **`projectContextExtractor`**: Ele usa BFS para varrer o projeto, extrai o `remappings.txt` e encontra arquivos de teste existentes para ensinar ao LLM o "padrão de importação" correto daquele repositório.
* **O Problema das Bibliotecas Ausentes:** Muitos projetos falhavam porque tentavam importar pacotes do NPM (como `@openzeppelin`) que não existiam na sandbox.
  * Criamos o **`dependencyStubber`**: Antes de escrever o teste, o agente roda um `forge build` falso. O compilador reclama das bibliotecas faltando, e o Stubber escreve automaticamente arquivos falsos `.sol` (Stubs) contendo contratos/interfaces vazias apenas para satisfazer o compilador.
* **Limpeza da Sandbox:** Adicionado mecanismo para deletar testes antigos do projeto (`.t.sol`) que davam conflito com o nosso gerador.
* **Resultado:** A taxa de sucesso global subiu para incríveis **54.5%**.

---

## v5.0 - Alinhamento com Produção (Fechando o Gap)
* **Commits base:** `b77ea464`
* **O Problema:** Todas as melhorias incríveis da V4 rodavam perfeitamente no *Benchmark*, mas não eram utilizadas na vida real (`server.ts`), pois a API não transferia os dados da auditoria para o testador.
* **A Correção:** 
  * O mapeador `mapFindingToReport` foi reescrito para incluir todo o texto do *Judge Review*, as recomendações de correção e as trilhas de ataque passo-a-passo no relatório que vai para o Tester.
  * O `server.ts` passou a fornecer o contexto estrutural do projeto (`repoContext`) e apontar o testador para usar a pasta real (`customSandboxDir`) onde o código foi salvo.
* **Resultado:** O pipeline de Produção e o Benchmark foram perfeitamente sincronizados.

---

## Próximos Passos (v6.0 Planejada)
* **LLM Routing / Multi-Model Cascade:** Dividir a execução entre LLMs. Utilizar um modelo potente (`gemini-2.5-pro` ou equivalente) apenas para o `analyzeVulnerabilityNode` e o `INITIAL` generation, economizando créditos nos loops de `FIX_COMPILE` que serão roteados para modelos menores, rápidos e baratos (como o `gemini-3.1-flash-lite`).

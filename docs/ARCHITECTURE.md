# Arquitetura do PoCo Agent (Proof-of-Concept Agent)

Este documento descreve detalhadamente o estado atual da arquitetura do Agente PoCo localizado em `src/agents/tester`, bem como a metodologia rigorosa de avaliação, as métricas e a estrutura dos datasets utilizados para validar a eficácia da Inteligência Artificial como auditora de Smart Contracts.

---

## 1. Arquitetura do Agente (`src/agents/tester`)

O Agente Tester foi projetado para atuar como um auditor de segurança e desenvolvedor de *exploits* totalmente autônomo. A espinha dorsal deste agente é construída sobre o framework **LangGraph**, que permite orquestrar nós de processamento como uma Máquina de Estados Finita (FSM). Essa abordagem cíclica mimetiza perfeitamente o raciocínio humano: Perceber, Planejar, Executar, Analisar o Feedback e Iterar.

### 1.1. O Grafo de Execução (Nodes)
A lógica principal está contida no arquivo `graph.ts`, onde o LangGraph roteia a execução pelos seguintes nós (Nodes):

1. **`oracleNode`**: Nó de inicialização. Carrega o contexto do ambiente e injeta a descrição original da vulnerabilidade (o relatório humano do auditor).
2. **`routerNode`**: Prepara o prompt inicial e configura o ambiente (como limites de iteração e injeção das descrições dos arquivos-alvo).
3. **`pocoAgentNode`**: O "Cérebro" do sistema. É aqui que o Modelo de Linguagem de Grande Escala (**LLM**) é invocado. Este nó avalia o estado atual do teste, analisa a saída dos erros anteriores e decide quais ferramentas invocar (ex: ler um arquivo, escrever um código, disparar a compilação). 
   - **Modelo Utilizado**: O sistema utiliza primariamente o modelo **Claude 3.5 Sonnet**, conhecido por sua alta capacidade de _reasoning_ técnico e programação.
4. **`pocoToolsNode`**: O nó de execução mecânica. Recebe o output estruturado do `pocoAgentNode` e executa as ações no sistema de arquivos real (ex: executa os binários do Foundry e escreve nos arquivos locais da sandbox).
5. **`trackToolCallsNode`**: Nó de avaliação de parada. Ele intercepta a saída do `smart_contract_test`. Se a saída for `Test Passed Successfully!` (ou seja, o exploit funcionou), ele altera o estado global para `success` e encerra o Grafo. Caso contrário, ele devolve o controle para o `pocoAgentNode` com o log de erro para a próxima iteração.

### 1.2. Ferramentas Disponibilizadas (Tools)
As ferramentas implementadas em `src/agents/tester/tools.ts` limitam e empoderam o agente:
- **`read_file` e `list_dir`**: Para exploração e compreensão da arquitetura do repositório vulnerável.
- **`write_file` e `edit_file`**: Para criação do arquivo `test/Exploit.t.sol`. A instrução exige que o agente não modifique os contratos de produção, apenas crie a PoC isolada.
- **`todo_planner`**: Ferramenta de memória de longo prazo que permite ao agente escrever e riscar checklists complexos de ataque.
- **`smart_contract_compile`**: Executa `forge build`. Útil para o agente limpar erros sintáticos de interfaces ou *mocks* antes do teste final.
- **`smart_contract_test`**: Executa a PoC. É a ferramenta que decide se o ciclo falha ou triunfa.

---

## 2. Métricas de Avaliação do Benchmark

Para validar se um LLM gerou um exploit real ou apenas sofreu alucinação, nós utilizamos três pilares absolutos extraídos do paper original do PoCo:

### 2.1. Reproducibility (Reprodutibilidade)
Mede se o agente conseguiu escrever uma PoC que compila e cujo teste passa com sucesso no ambiente vulnerável original. 
- **Como funciona:** O `runTesterBenchmark.ts` clona o repositório na versão exata em que o auditor humano reportou a falha, injeta o agente e espera que ele gere o `Exploit.t.sol`. Se o `forge test` da PoC passar, o projeto ganha a flag `Reproducible=true`.

### 2.2. Specificity (Especificidade)
Uma PoC só tem valor real se ela falhar quando a vulnerabilidade for corrigida. Isso prova que o agente focou cirurgicamente na falha arquitetural e não escreveu um teste vazio que passa independentemente do código.
- **Como funciona:** Imediatamente após o agente conseguir uma PoC válida no código vulnerável, o nosso script de Benchmark injeta secretamente os **arquivos já corrigidos com o Patch Oficial** (diretamente da branch fix do protocolo) por cima do código vulnerável. O script roda o `forge test` do agente novamente. Se o teste do agente **FALHAR** (pois o roubo não é mais possível), a PoC prova sua eficácia clínica e recebe a flag `Specific=true`.

### 2.3. Teste de Falso Positivo (Hallucination Resistance)
Para termos a confiança final na arquitetura, precisamos provar que o agente não gera exploits fantasmas.
- **O Cenário de Falso Positivo:** Alimentamos o agente com um repositório 100% seguro (já com o patch aplicado) e mandamos uma informação falsa (o relatório original de vulnerabilidade).
- **O Comportamento Esperado:** Um agente de segurança verdadeiro deve investigar o código, tentar gerar a PoC iterativamente, notar que os `requires` do protocolo bloqueiam qualquer roubo descrito na anotação, e finalmente desistir (esgotando as iterações) sem gerar uma PoC bem-sucedida. Se o agente gerasse uma PoC de sucesso aqui, seria uma falha grave da arquitetura.

---

## 3. Estrutura dos Datasets

A inteligência do Agente é submetida a problemas de níveis de complexidade crescentes:

### 3.1. Datasets Easy & Intermediate
- **Easy**: Desafios sintéticos e isolados (CTFs de 1 a 2 contratos). Avalia o conhecimento intrínseco sobre vetores canônicos (Reentrancy, Integer Overflow) sem barreiras arquiteturais.
- **Intermediate**: Clones reduzidos de protocolos reais (ex: forks de cofres simples). Testa se o agente consegue coordenar a interação entre alguns contratos e usar os cheatcodes complexos do Foundry (como `vm.prank`, `vm.warp` e `vm.expectRevert()`).

### 3.2. Dataset Hard (`Proof-of-Patch-only-dataset`)
Este é o teste acadêmico definitivo. Composto por repositórios auditados do mundo real vindos do Code4rena e Sherlock. Os protocolos contêm dezenas de contratos interligados.

O dataset original cataloga um total de **23 vulnerabilidades**.

#### Por que o artigo testa apenas 13 das 23 vulnerabilidades?
No paper original do PoCo, das 23 listadas, apenas 13 foram consideradas "prontas para compilação automatizada". As outras 10 requeriam intervenção humana excessiva para rodar no Foundry (ex: versões ultra específicas do compilador, setups de rede complexos ou forks pesados que impossibilitavam o uso cego do `forge test`).

#### Por que avaliamos apenas 6 em nosso rigoroso teste final?
Ao validarmos de perto a infraestrutura fornecida em nosso repositório para essas 13 vulnerabilidades, expomos um erro silencioso nos dados: **mais da metade (7 projetos) estava fisicamente corrompida**.

Projetos como os ligados ao protocolo *Caviar* (`009`, `018`, `033`, `048`), entre outros, apresentavam:
1. **Submódulos Mortos**: Diretórios de bibliotecas vitais foram deletados no GitHub original e constavam vazios no dataset, quebrando qualquer importação de base.
2. **Dependências NPM em Conflito**: Pacotes e scripts NodeJS mal resolvidos que quebravam antes do setup.
3. **Erros de "Out-of-the-Box"**: O comando puro `forge build` na raiz do projeto original (sem o agente tocar em uma linha de código) falhava.

Se o agente fosse jogado nesse cenário falho, a saída de erro recebida faria o LLM lutar contra a infraestrutura de pastas corrompidas — tentando recriar os módulos do zero, deletando heranças arquiteturais e alucinando interfaces de sistema — desviando o foco do ataque ao Smart Contract.

Para avaliar **puramente a capacidade analítica de segurança da Inteligência Artificial**, usamos um script isolado para filtrar o dataset original e isolar **apenas os 6 repositórios que compilaram perfeitamente na primeira tentativa sem interrupção**.

Nosso Benchmark final, focado exclusivamente nestes 6 projetos limpos, retornou um histórico impressionante de **50% de taxa de sucesso (Verified Ground Truth)** em exploração automatizada e autônoma, validando perfeitamente a eficácia desta infraestrutura de agentes para o cenário real da Web3.

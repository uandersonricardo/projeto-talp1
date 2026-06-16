export const RANK_FILES_PROMPT = `Você é um especialista em segurança de smart contracts. Dada a árvore de arquivos do repositório e uma lista de contratos Solidity, classifique cada arquivo pela sua importância para a descoberta de vulnerabilidades de segurança.

Para cada arquivo atribua:
- importance: inteiro de 1 (menos importante) a 5 (mais importante)
- reasoning: uma frase concisa justificando a classificação (mencione o papel específico do contrato, não categorias genéricas)

Critérios de classificação:
- Importância 5: lógica central do protocolo (vaults, pools, engines), custódia de tokens/ETH, mecanismos de upgrade/proxy, cálculos financeiros críticos (preço, juros, liquidação), controle de acesso raiz.
- Importância 4: contratos que movem valor e interagem diretamente com os de importância 5, máquinas de estado complexas, distribuição de taxas/recompensas, roteadores de entrada.
- Importância 3: helpers periféricos com lógica de negócio, bibliotecas reutilizáveis com efeitos colaterais, governança com timelocks.
- Importância 2: interfaces, adaptadores, wrappers triviais, contratos utilitários sem lógica crítica.
- Importância 1: views somente-leitura, arquivos de constantes/configuração pura, mocks e scripts de deploy.

Retorne a classificação de TODOS os arquivos fornecidos, sem omitir nenhum.`;

export const GATHER_CONTEXT_PROMPT = `Você é um especialista em segurança de smart contracts criando um modelo mental preciso do protocolo para auditoria. Você receberá documentação e a análise estrutural dos contratos Solidity em escopo.

**REGRA DE FIDELIDADE FACTUAL — NÃO NEGOCIÁVEL**: Baseie-se EXCLUSIVAMENTE no que está EXPLICITAMENTE presente no código-fonte (linhas de código, NatSpec, comentários inline) ou na documentação fornecida. NUNCA infira, suponha, extrapole ou "complete" informações que não estejam literalmente escritas nas fontes. Se uma informação não aparece explicitamente, NÃO a inclua e NÃO a invente. Esta regra se aplica a TODAS as seções. **Na seção Trust Assumptions esta proibição é ABSOLUTA: se não há declaração explícita (código, NatSpec, comentário ou doc) sobre uma suposição, ela não existe para você.**

Produza um contexto factual e detalhado de auditoria sem introduções, sem padding e sem repetições. Preserve nomes concretos (funções, variáveis, tipos, valores numéricos) exatamente como aparecem no código. Sem prosa explicativa.

A árvore de arquivos do repositório e a análise estrutural completa de cada contrato serão anexadas automaticamente ao final do contexto — **não as duplique**. Concentre-se nas seções de síntese abaixo.

## Visão geral
Descreva o propósito do protocolo, o fluxo econômico principal, os participantes envolvidos e os ativos protegidos — apenas o que estiver explicitamente declarado no código ou na documentação.

## Estado Crítico
Todas as variáveis de estado com impacto em lógica de negócio, segurança ou contabilidade, extraídas diretamente da seção Storage da análise estrutural.
Formato por bullet: \`filePath::nomeVar (tipo, visibilidade) — NatSpec/comentário se presente — funções que escrevem nela — impacto se manipulada\`.
Omita apenas constantes e imutáveis puramente administrativas (nome do token, símbolo, decimals, versão de string).

## Fluxos Principais (máx. 5 fluxos, 3–6 passos cada)
Apenas os caminhos críticos ponta a ponta que movem valor ou alteram estado relevante, derivados das funções e call graphs observados no código.
Formato por passo: \`ação (função) → efeito colateral → variável/estado alterado\`.
Inclua chamadas cross-contract quando materiais para entender superfície de ataque.

## Invariantes e Propriedades de Segurança
Condições que devem ser verdadeiras para o protocolo operar corretamente, derivadas APENAS de \`require\`/\`assert\`/\`revert\` explícitos no código, NatSpec \`@dev\`, ou comentários que as declarem literalmente. Separe em dois grupos:
- **Contábeis**: balanços, totais, proporções (ex.: \`totalDebt == Σ userDebt[i]\`, \`reservas >= totalSupply * exchangeRate\`)
- **De controle**: acesso, sequência de operações, transições de estado permitidas

## Trust Assumptions
⚠ **SOMENTE o que estiver EXPLICITAMENTE declarado** em código-fonte (require, NatSpec, comentários inline) ou na documentação. **NÃO inferir. NÃO supor. NÃO extrapolar.** Se não há declaração explícita sobre confiança em um componente externo ou comportamento esperado, ele NÃO entra nesta seção — mesmo que pareça óbvio.
Bullets curtos com referência à fonte (ex.: "owner pode pausar o contrato — \`onlyOwner\` em \`pause()\`").

## Regras de Negócio e Restrições de Segurança
Em bullets: roles e modifiers relevantes (nomes exatos do código), limites numéricos (apenas valores literais presentes no código-fonte), taxas e destinatários, timelocks, pausabilidade, condições de upgrade, restrições de whitelist/blacklist. Inclua apenas regras com impacto direto em vetores de ataque.

**Formato obrigatório**: bullets e frases curtas. Dados concretos (nomes de funções, variáveis, valores numéricos) exatamente como aparecem no código. Sem prosa explicativa.`;

export const FIND_VULNERABILITIES_PROMPT = `Você é um auditor especialista em segurança de smart contracts com profundo conhecimento em Solidity, execução EVM e design de protocolos. Assuma que todos os usuários são adversariais e estão ativamente tentando explorar o contrato.

Sua tarefa é analisar o código-fonte fornecido linha a linha e identificar todas as vulnerabilidades de segurança, design, lógica e econômicas. Qualquer discrepância entre a implementação e o comportamento esperado, as suposições do protocolo ou o design econômico deve ser reportada como vulnerabilidade, mesmo que o contrato execute sem erros em runtime.

**Escopo obrigatório da análise**

Além das categorias técnicas listadas abaixo, sua análise deve cobrir:

- **Invariantes de protocolo**: identifique invariantes implícitas e explícitas (ex.: depósitos devem igualar saques, ativos devem permanecer colateralizados, recompensas devem corresponder aos inputs) e verifique se podem ser quebradas.
- **Fluxos de valor**: analise exaustivamente todas as transferências de valor (taxas, saldos, depósitos, saques, recompensas, deltas), verificando: quem provê os fundos, quem os recebe, e se os fundos são corretamente custodiados (escrowed) antes da transferência.
- **Validação de ownership**: verifique se usuários podem interagir com tokens, NFTs ou permissões que não controlam.
- **Observabilidade**: avalie se eventos, logs e chamadas de métodos representam corretamente as ações do protocolo. Emissão ausente, incorreta ou enganosa é uma vulnerabilidade.
- **Implementação vs. intenção**: qualquer desvio entre o comportamento implementado e o design pretendido do protocolo deve ser reportado.

## Categorias técnicas a verificar sistematicamente

Reentrância (simples, cross-function, cross-contract, read-only), controle de acesso (funções privilegiadas desprotegidas, erros em herança de roles), overflow/underflow (Solidity <0.8 ou uso de \`unchecked\`), manipulação de oráculo (TWAP curto, preço spot, valor de reserves), ataques de flash loan (price impact, liquidações artificiais), front-running e MEV (sandwich, race condition em aprovações), replay de assinatura (nonce ausente, falta de chainId), colisões de storage (proxies, delegatecall), proxies não inicializados (initializer sem proteção), delegatecall inseguro (destino controlável pelo usuário), griefing de gas (loops ilimitados, arrays crescentes), negação de serviço (push payments, dependência de chamada externa), perda de precisão (divisão antes de multiplicação, truncamento acumulativo), lógica de negócio (violação de invariantes, casos de borda em math financeira, race conditions de estado), eficiência de gas, boas práticas.

## Formato de saída

Para cada vulnerabilidade encontrada, forneça OBRIGATORIAMENTE todos os campos abaixo. Cada entrada deve ser **atômica**: reporte exatamente um problema por entrada. Não agrupe múltiplos problemas em um único achado, mesmo que ocorram na mesma função ou linha. Não há limite para o número de vulnerabilidades reportadas.

- **title**: Nome curto e preciso (ex.: "Reentrância em \`withdraw\`", "Controle de acesso ausente em \`setFee\`").
- **description**: Descreva (a) o comportamento **esperado** pelo protocolo, (b) o comportamento **observado** no código vulnerável, e (c) o impacto concreto se explorado. Mínimo 3 frases, máximo 5.
- **exploit_scenario**: Descreva um cenário concreto e passo a passo de como um atacante exploraria a vulnerabilidade.
- **recommendation**: Correção específica e acionável com referência ao padrão ou mecanismo correto (ex.: "Aplicar checks-effects-interactions: mover \`balances[msg.sender] -= amount\` para antes da chamada externa").
- **severity**: Exatamente um de: \`"high"\` (perda direta de fundos ou tomada de controle do contrato), \`"medium"\` (risco indireto ou condicional), \`"low"\` (problema de boas práticas, sem risco financeiro imediato).
- **location**: Função e/ou número de linha onde o problema ocorre.
- **codeSnippet**: O trecho exato e completo do código vulnerável, copiado literalmente do código-fonte. **Proibido** usar reticências (\`...\`), omissões, pseudocódigo ou paráfrases. Inclua as linhas exatas conforme aparecem no arquivo, com indentação original preservada. Se o snippet for maior que 40 linhas, inclua o intervalo completo sem cortes.

## Regra de completude

Reporte vulnerabilidades mesmo que não sejam imediatamente exploráveis. Vulnerabilidades podem ser de segurança, inconsistências de design, desalinhamentos econômicos ou falhas de observabilidade. Se nenhuma vulnerabilidade for encontrada, retorne um array vazio.`;

export const REFINE_VULNERABILITIES_PROMPT = `Você é um auditor sênior de segurança de smart contracts refinando seus próprios achados com base no feedback de um revisor especialista independente.

Na iteração anterior, você analisou um contrato Solidity e gerou uma lista de vulnerabilidades candidatas. Um revisor especialista avaliou cada achado e forneceu: veredicto (verdadeiro ou falso positivo), análise técnica detalhada, nível de confiança e caminhos de exploit ou razões de bloqueio.

**Sua tarefa**: produzir uma lista final e refinada de vulnerabilidades incorporando o feedback do revisor.

## Regras de refinamento

1. **Falso positivo com confiança ≥ 80%**: remova o achado sem exceção.
2. **Falso positivo com confiança < 80%**: reavalie com base na análise do revisor. Mantenha apenas se encontrar evidência nova ou argumento técnico que o revisor não considerou — e reflita isso na descrição.
3. **Verdadeiro positivo**: mantenha o achado. Incorpore melhorias sugeridas pelo revisor (descrição mais precisa, snippet mais completo, recomendação mais específica, caminhos de exploit detalhados).
4. **Novos achados**: se o revisor apontou superfícies de ataque não cobertas em seus achados originais, investigue o código-fonte e adicione novos achados para elas.
5. Não adicione achados que não sejam suportados pelo código-fonte ou pelo feedback do revisor.

## Formato de saída

Idêntico ao da análise inicial. Para cada vulnerabilidade:
- **title**: nome curto e preciso
- **description**: (a) comportamento esperado, (b) comportamento observado, (c) impacto concreto — mínimo 3 frases, máximo 5
- **recommendation**: correção específica e acionável com referência ao padrão correto
- **severity**: \`"high"\` / \`"medium"\` / \`"low"\`
- **codeSnippet**: trecho exato e completo copiado literalmente do código-fonte, sem omissões, reticências ou pseudocódigo

Se nenhuma vulnerabilidade restar após o refinamento, retorne um array vazio.`;

export const JUDGE_FINDINGS_PROMPT = `Você é um revisor rigoroso de segurança de smart contracts com profundo conhecimento em Solidity, execução EVM e design de protocolos. Avalie cada vulnerabilidade candidata submetida pelo auditor e determine se é um verdadeiro positivo ou um falso positivo.

Para cada achado, forneça OBRIGATORIAMENTE todos os campos abaixo:

- **review**: Análise técnica detalhada (3 a 6 frases) explicando o veredicto. Referencie: (a) o código específico envolvido, (b) invariantes ou premissas do protocolo que confirmam ou bloqueiam o exploit, (c) pré-condições necessárias para exploração, (d) controles mitigadores existentes que o auditor pode ter ignorado. Seja preciso — cite nomes de funções, variáveis e valores.
- **isFalsePositive**: \`true\` se o achado NÃO for explorável na prática; \`false\` se for uma vulnerabilidade real.
- **confidence**: Inteiro de 0 a 100 refletindo sua certeza no veredicto. Use < 60 apenas quando existir ambiguidade genuína no código.
- **exploitablePaths**: Array de strings.
  - Se verdadeiro positivo (\`isFalsePositive: false\`): forneça 1 a 3 caminhos concretos de exploit, cada um com passos numerados, entradas realistas e estado do contrato antes/depois. Ex.: ["1. Atacante chama flashLoan(500k USDC). 2. No callback, chama deposit() inflando reserves. 3. Chama withdraw() com preço manipulado. 4. Lucra 50k USDC. Estado: reserves inflado temporariamente, totalShares inalterado."].
  - Se falso positivo (\`isFalsePositive: true\`): forneça o raciocínio exato que bloqueia cada caminho de exploit tentado pelo auditor.

## Critérios para falso positivo (aplique com rigor — não seja permissivo)

1. O caminho de exploit é bloqueado por controle de acesso verificável no código.
2. A vulnerabilidade já é totalmente mitigada por outro mecanismo no código (ex.: nonReentrant, require com validação suficiente).
3. A condição necessária para o exploit é impossível ou economicamente inviável dado o modelo do protocolo (ex.: requer ser o próprio contrato, ou lucro < custo de gas em qualquer cenário realista).
4. O comportamento é explicitamente documentado como intencional nas premissas de design do protocolo.

## Critérios para verdadeiro positivo
- Existe pelo menos um caminho de exploit concreto e realista que viola uma invariante ou permite extração de valor não autorizada.
- Não exige condições impossíveis nem assume acesso privilegiado não disponível ao atacante.
- Inclui qualquer discrepância entre a implementação e a intenção, premissas ou objetivos documentados — mesmo que o contrato opere sem erros em runtime. Isso abrange problemas de segurança, inconsistências de design, desalinhamentos econômicos e falhas de observabilidade, independentemente de exploitabilidade direta.`;

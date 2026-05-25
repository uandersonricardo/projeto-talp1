import { ChatPromptTemplate } from "@langchain/core/prompts";

/**
 * Prompt para gerar smart contracts Solidity a partir de requisitos.
 */
export const solidityCoderPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `Você é um desenvolvedor sênior especialista em smart contracts Solidity.
Sua função é gerar contratos Solidity completos, compiláveis e seguros.

Regras:
- Gere código Solidity production-ready
- Use pragma solidity ^0.8.20
- NÃO use imports externos (OpenZeppelin, etc.) — implemente tudo inline
- Adicione comentários NatDoc explicativos
- Inclua eventos para todas as operações relevantes
- Use modificadores de acesso customizados (ex: onlyOwner)
- Inclua tratamento de erros com require e mensagens claras
- Siga boas práticas de segurança (checks-effects-interactions, proteção contra reentrância)
- NÃO use placeholders como "TODO" ou "implementar depois"
- O contrato deve compilar sem erros com solc 0.8.20+`,
  ],
  [
    "human",
    `Gere um smart contract Solidity completo com base nos seguintes requisitos:

{requirements}

Retorne APENAS o código Solidity completo, sem explicações adicionais.
O código deve ser auto-contido (sem imports externos).`,
  ],
]);

/**
 * Prompt para corrigir erros de compilação em contratos Solidity.
 */
export const solidityFixPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `Você é um desenvolvedor sênior especialista em smart contracts Solidity.
Sua função é corrigir erros de compilação em contratos Solidity.

Regras:
- Corrija TODOS os erros indicados
- Mantenha a lógica de negócio original intacta
- NÃO adicione imports externos
- O contrato deve compilar sem erros com solc 0.8.20+
- Retorne APENAS o código Solidity corrigido completo`,
  ],
  [
    "human",
    `O seguinte contrato Solidity tem erros de compilação. Corrija-os:

**Código atual:**
\`\`\`solidity
{contract}
\`\`\`

**Erros de compilação:**
{errors}

Retorne APENAS o código Solidity corrigido completo, sem explicações.`,
  ],
]);

/**
 * Prompt para revisar contratos Solidity quanto a segurança e boas práticas.
 */
export const solidityReviewPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `Você é um auditor de segurança sênior especialista em smart contracts Solidity.
Analise o contrato quanto a:
- Vulnerabilidades de segurança (reentrância, overflow, acesso não autorizado)
- Aderência a boas práticas Solidity
- Legibilidade e manutenibilidade
- Potenciais problemas de gas

Seja objetivo e conciso. Responda em português brasileiro.`,
  ],
  [
    "human",
    `Revise o seguinte smart contract:

**Requisitos originais:**
{requirements}

**Código:**
\`\`\`solidity
{contract}
\`\`\`

Forneça um resumo breve da revisão em 2-3 frases destacando se o contrato está seguro e funcional.`,
  ],
]);

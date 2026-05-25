# Requisitos do Smart Contract

## Descrição
Token ERC20 com funcionalidades de controle de acesso e pausa.

## Requisitos Funcionais

1. Implementar um token ERC20 com nome, símbolo e supply configuráveis
2. O contrato deve ser pausável (funções de transferência bloqueadas quando pausado)
3. Apenas o owner pode pausar e despausar o contrato
4. O owner pode criar (mint) novos tokens
5. Qualquer holder pode queimar (burn) seus próprios tokens

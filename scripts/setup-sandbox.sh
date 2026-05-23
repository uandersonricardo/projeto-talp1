#!/bin/bash
set -e

SANDBOX="/tmp/poc-sandbox"
FORGE_BIN="$HOME/.foundry/bin/forge"

echo "Inicializando sandbox Foundry em $SANDBOX..."
rm -rf "$SANDBOX"
mkdir -p "$SANDBOX"
cd "$SANDBOX"

# Iniciar projeto forge mínimo sem git
"$FORGE_BIN" init --no-git --quiet

# Limpar arquivos padrão que causam erros de importação se deletados parcialmente
rm -rf src/*
rm -rf test/*
rm -rf script/*

# Criar foundry.toml configurado
cat > foundry.toml << 'EOF'
[profile.default]
src = "src"
test = "test"
script = "script"
out = "out"
libs = ["lib"]
solc-version = "0.8.20"
optimizer = true
optimizer_runs = 200
EOF

echo "Sandbox pronto. Testando com forge build..."
"$FORGE_BIN" build
echo "OK — sandbox funcionando em $SANDBOX"

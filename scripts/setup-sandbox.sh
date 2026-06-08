#!/bin/bash
set -e

SANDBOX="${SANDBOX_DIR:-/tmp/poc-sandbox}"

# Tenta encontrar forge no PATH se a variável não estiver definida ou falhar
if [ -z "$FORGE_BIN" ] || [ ! -f "$FORGE_BIN" ]; then
    FORGE_BIN=$(which forge || echo "forge")
fi

echo "Inicializando sandbox Foundry em $SANDBOX usando $FORGE_BIN..."
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
solc_version = "0.8.20"
optimizer = true
optimizer_runs = 200
EOF

echo "Sandbox pronto. Testando com forge build..."
"$FORGE_BIN" build
echo "OK — sandbox funcionando em $SANDBOX"

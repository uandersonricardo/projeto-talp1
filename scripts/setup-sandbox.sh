#!/bin/bash
set -e

SANDBOX="${SANDBOX_DIR:-/tmp/poc-sandbox}"

# Source Foundry environment (sets PATH in non-interactive shells like Docker)
if [ -f "$HOME/.foundry/env" ]; then
    source "$HOME/.foundry/env"
fi

# Resolve forge binary: env var > PATH > common install locations
if [ -z "$FORGE_BIN" ] || [ ! -f "$FORGE_BIN" ]; then
    if command -v forge &>/dev/null; then
        FORGE_BIN=$(command -v forge)
    elif [ -f "$HOME/.foundry/bin/forge" ]; then
        FORGE_BIN="$HOME/.foundry/bin/forge"
    else
        echo "ERROR: forge not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
        exit 1
    fi
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

set shell := ["bash", "-euo", "pipefail", "-c"]

default: check

install:
	bun install

test:
	bun test --isolate

typecheck:
	bunx tsc --noEmit

lint:
	bunx biome check .

format:
	bunx biome check --write .

rpc-verify:
	dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT; { echo '{"type":"get_commands","id":"1"}'; sleep 2; } | PI_CODING_AGENT_DIR="$dir" timeout 30 ${PI_BIN:-pi-bolt} --mode rpc --no-session -ne --offline -e ./src/index.ts

omp-verify:
	command -v omp >/dev/null || { echo "omp not installed; skipped"; exit 0; }; dir=$(mktemp -d); out=$(mktemp); trap 'rm -rf "$dir" "$out"' EXIT; { sleep 4; } | PI_CODING_AGENT_DIR="$dir" timeout 20 omp --mode rpc --no-session --no-extensions --offline -e ./src/omp.ts >"$out" 2>&1 || true; ! grep -q "Failed to load extension" "$out" || { cat "$out"; exit 1; }; grep -q '"name":"auth"' "$out" || { cat "$out"; exit 1; }; echo "omp-verify: ok"

parity-verify:
	bun scripts/parity-verify.ts

aot-verify:
	bun scripts/aot-verify.ts

check: typecheck lint test

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

parity-verify:
	bun scripts/parity-verify.ts

aot-verify:
	bun scripts/aot-verify.ts

check: typecheck lint test

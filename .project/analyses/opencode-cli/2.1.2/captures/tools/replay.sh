#!/usr/bin/env bash
# replay.sh <name> <path> [curl -H args...]
# Sends a minimal non-streaming big-pickle request to Zen and records status + body.
set -u
name="$1"; shift
path="$1"; shift
out="/tmp/zenproxy/replay"
mkdir -p "$out"
body='{"model":"big-pickle","messages":[{"role":"user","content":"Reply with exactly: pong"}],"max_tokens":16,"stream":false}'
args=(-s -o "$out/$name.body" -w "%{http_code}" -X POST "https://opencode.ai$path" -H "content-type: application/json" --data "$body")
for h in "$@"; do args+=(-H "$h"); done
status=$(curl "${args[@]}")
printf '%s' "$status" > "$out/$name.status"
head="$(head -c 200 "$out/$name.body" | tr '\n' ' ')"
echo "$name path=$path status=$status body=$head"

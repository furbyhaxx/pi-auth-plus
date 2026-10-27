#!/usr/bin/env bash
# replay3.sh <name> <path> <bodyfile> [curl -H args...] -- via the Bun-transport proxy
set -u
name="$1"; shift
path="$1"; shift
bodyfile="$1"; shift
out="/tmp/zenproxy/replay"
mkdir -p "$out"
args=(-s -o "$out/$name.body" -w "%{http_code}" -X POST "http://127.0.0.1:18900$path" -H "content-type: application/json" --data-binary "@$bodyfile")
for h in "$@"; do args+=(-H "$h"); done
status=$(curl "${args[@]}")
printf '%s' "$status" > "$out/$name.status"
head="$(head -c 140 "$out/$name.body" | tr '\n' ' ')"
echo "$name -> $status | $head"

#!/bin/bash
# Ask the research agent a question. The server is configured with its own
# upstream LLM (defaults to OpenRouter free Gemma 4) — no per-request
# credentials needed.
#
# Usage:
#   research.sh "your question"
#   research.sh --raw "your question"             # full JSON output
#   research.sh --max-iterations 12 "..."
#   research.sh --override-llm "url|token|model" "..."   # admin: use a different LLM
#
# Env:
#   RESEARCH_URL    (default https://coachpixel.com/api/research)
#   RESEARCH_TOKEN  required — must match the value in .env on the CX33

set -euo pipefail

RESEARCH_URL="${RESEARCH_URL:-https://coachpixel.com/api/research}"
MAX_ITER=8
RAW=0
OVERRIDE=""

usage() {
  sed -n '3,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[ $# -ge 1 ] || usage

QUERY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --raw) RAW=1; shift;;
    --max-iterations) MAX_ITER="$2"; shift 2;;
    --override-llm) OVERRIDE="$2"; shift 2;;
    -h|--help) usage;;
    *) QUERY="${QUERY}${QUERY:+ }$1"; shift;;
  esac
done
[ -n "$QUERY" ] || usage

[ -n "${RESEARCH_TOKEN:-}" ] || {
  echo "RESEARCH_TOKEN env var required (must match the one set on the server)" >&2
  exit 2
}

if [ -n "$OVERRIDE" ]; then
  IFS='|' read -r URL TOKEN MODEL <<<"$OVERRIDE"
  PAYLOAD=$(jq -n \
    --arg query "$QUERY" \
    --arg url "$URL" \
    --arg token "$TOKEN" \
    --arg model "$MODEL" \
    --argjson maxIterations "$MAX_ITER" \
    '{query: $query, gemma: {url: $url, token: $token}, model: $model, maxIterations: $maxIterations}')
else
  PAYLOAD=$(jq -n \
    --arg query "$QUERY" \
    --argjson maxIterations "$MAX_ITER" \
    '{query: $query, maxIterations: $maxIterations}')
fi

RESPONSE=$(curl -sS --max-time 600 "$RESEARCH_URL" \
  -H "Authorization: Bearer $RESEARCH_TOKEN" \
  -H "content-type: application/json" \
  -d "$PAYLOAD")

if [ "$RAW" = "1" ]; then
  echo "$RESPONSE" | jq
else
  echo "$RESPONSE" | jq -r '.answer // (. | tostring)'
fi

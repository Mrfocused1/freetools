#!/bin/bash
# Ask Gemma 4 a question — it'll search the web (Searxng on CX33) and read
# pages (Crawl4AI on CX33) before answering.
#
# Usage:
#   research.sh "your question"
#   research.sh --max-iterations 12 "your question"
#   research.sh --raw "your question"            # pretty-prints JSON instead of just the answer
#
# Requires:
#   - vast.ai instance running (run gemma4-up.sh first, or pass --autostart)
#   - RESEARCH_TOKEN env var matching the value in .env on the CX33
#   - RESEARCH_URL env var (default: https://coachpixel.com/api/research)

set -euo pipefail

STATE="$HOME/.vast-gemma4"
RESEARCH_URL="${RESEARCH_URL:-https://coachpixel.com/api/research}"
MAX_ITER=8
RAW=0
AUTOSTART=0

usage() {
  sed -n '3,11p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[ $# -ge 1 ] || usage

QUERY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --raw) RAW=1; shift;;
    --max-iterations) MAX_ITER="$2"; shift 2;;
    --autostart) AUTOSTART=1; shift;;
    -h|--help) usage;;
    *) QUERY="${QUERY}${QUERY:+ }$1"; shift;;
  esac
done
[ -n "$QUERY" ] || usage

[ -n "${RESEARCH_TOKEN:-}" ] || {
  echo "RESEARCH_TOKEN env var required (must match the one set on the server)" >&2
  exit 2
}

# Ensure Gemma 4 is up.
if [ ! -f "$STATE" ]; then
  if [ "$AUTOSTART" = "1" ]; then
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    "$SCRIPT_DIR/gemma4-up.sh" >/dev/null
  else
    echo "Gemma 4 isn't running. Start it first:" >&2
    echo "    bash $(dirname "$0")/gemma4-up.sh" >&2
    echo "Then re-run, or pass --autostart." >&2
    exit 3
  fi
fi

GEMMA_URL=$(jq -r '.url' "$STATE")
GEMMA_TOKEN=$(jq -r '.token' "$STATE")
GEMMA_MODEL=$(jq -r '.model' "$STATE")

PAYLOAD=$(jq -n \
  --arg query "$QUERY" \
  --arg url "$GEMMA_URL" \
  --arg token "$GEMMA_TOKEN" \
  --arg model "$GEMMA_MODEL" \
  --argjson maxIterations "$MAX_ITER" \
  '{query: $query, gemma: {url: $url, token: $token}, model: $model, maxIterations: $maxIterations}')

RESPONSE=$(curl -sS --max-time 600 "$RESEARCH_URL" \
  -H "Authorization: Bearer $RESEARCH_TOKEN" \
  -H "content-type: application/json" \
  -d "$PAYLOAD")

if [ "$RAW" = "1" ]; then
  echo "$RESPONSE" | jq
else
  echo "$RESPONSE" | jq -r '.answer // (. | tostring)'
fi

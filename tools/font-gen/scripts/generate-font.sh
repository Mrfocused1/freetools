#!/bin/bash
# Local CLI for testing the font-gen worker.
#
# Usage:
#   generate-font.sh <image_path> [--family MyFont] [--charset "ABC...abc...012..."]
#
# Reads FONT_GEN_URL and FONT_GEN_TOKEN from ~/.vast-font-gen (or env).
# Downloads the generated TTF to ./<family>.ttf in the current directory.
#
# Requires: jq, curl, base64 (macOS: gbase64 or the system base64)

set -euo pipefail

STATE="$HOME/.vast-font-gen"

# --- Defaults ---------------------------------------------------------------
FAMILY="CustomFont"
CHARSET="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

# --- Parse args -------------------------------------------------------------
if [ $# -lt 1 ]; then
  echo "Usage: $0 <image_path> [--family <name>] [--charset <chars>]" >&2
  exit 1
fi

IMAGE_PATH="$1"; shift

while [ $# -gt 0 ]; do
  case "$1" in
    --family)  FAMILY="$2";  shift 2;;
    --charset) CHARSET="$2"; shift 2;;
    -h|--help)
      sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

[ -f "$IMAGE_PATH" ] || { echo "file not found: $IMAGE_PATH" >&2; exit 1; }

# --- Resolve URL + token ----------------------------------------------------
if [ -n "${FONT_GEN_URL:-}" ] && [ -n "${FONT_GEN_TOKEN:-}" ]; then
  URL="$FONT_GEN_URL"
  TOKEN="$FONT_GEN_TOKEN"
elif [ -f "$STATE" ]; then
  URL=$(jq -r '.url' "$STATE")
  TOKEN=$(jq -r '.token' "$STATE")
else
  echo "No worker configured. Set FONT_GEN_URL/FONT_GEN_TOKEN or run font-gen-up.sh first." >&2
  exit 2
fi

command -v jq   >/dev/null || { echo "jq required: brew install jq" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl required" >&2; exit 2; }

# --- Encode image to data URL -----------------------------------------------
MIME="image/png"
case "${IMAGE_PATH##*.}" in
  jpg|jpeg) MIME="image/jpeg";;
  webp)     MIME="image/webp";;
esac

# macOS ships base64 without -w; Linux base64 needs -w 0.
if base64 --version 2>&1 | grep -q GNU; then
  B64=$(base64 -w 0 < "$IMAGE_PATH")
else
  B64=$(base64 < "$IMAGE_PATH")
fi
DATA_URL="data:${MIME};base64,${B64}"

# --- Call the worker --------------------------------------------------------
OUT_FILE="${FAMILY}.ttf"
echo "[*] sending image to $URL/generate ..." >&2

RESPONSE=$(curl -fsS --max-time 300 \
  -X POST "$URL/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
        --arg img "$DATA_URL" \
        --arg fam "$FAMILY" \
        --arg cs  "$CHARSET" \
        '{imageDataUrl:$img, fontFamily:$fam, targetCharset:$cs}')")

echo "$RESPONSE" | python3 -c "
import sys, json, base64, os
d = json.load(sys.stdin)
if 'ttfBase64' in d:
    with open('${OUT_FILE}', 'wb') as f:
        f.write(base64.b64decode(d['ttfBase64']))
    print(f'[*] saved ${OUT_FILE}')
elif 'ttfUrl' in d:
    print(f'[*] download URL: ' + d['ttfUrl'])
else:
    print('unexpected response:', json.dumps(d, indent=2))
    sys.exit(1)
"

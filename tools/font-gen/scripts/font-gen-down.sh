#!/bin/bash
# Tear down the font-gen vast.ai instance and any orphans with our label.
set -euo pipefail

STATE="$HOME/.vast-font-gen"
LABEL="font-gen-server"

destroy() {
  local id="$1"
  echo "[*] destroying instance $id..." >&2
  echo y | vastai destroy instance "$id" 2>&1 | tail -1 || true
}

if [ -f "$STATE" ]; then
  ID=$(jq -r '.id' "$STATE" 2>/dev/null || echo "")
  [ -n "$ID" ] && destroy "$ID"
  rm -f "$STATE"
fi

# Also kill any orphans labeled font-gen-server.
vastai show instances --raw 2>/dev/null \
  | jq -r ".[] | select(.label==\"$LABEL\") | .id" \
  | while read -r oid; do
      destroy "$oid"
    done

echo "[*] done. Remember to unset FONT_GEN_URL / FONT_GEN_TOKEN on the server" \
     "and restart the web container." >&2

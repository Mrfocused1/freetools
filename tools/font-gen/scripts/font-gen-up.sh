#!/bin/bash
# Provision a vast.ai GPU instance running the font-gen pipeline worker.
#
# Usage:
#   font-gen-up.sh [--gpu RTX_4090] [--vram 16] [--disk 50]
#
# State file: ~/.vast-font-gen  ({id, token, url})
#
# After provisioning, the admin must set two env vars on the production server
# (or in .env) so Next.js can reach the worker:
#
#   FONT_GEN_URL=<url printed by this script>
#   FONT_GEN_TOKEN=<token printed by this script>
#
# These are intentionally NOT auto-patched via SSH here — the admin controls
# when to apply them and restart the web container, which avoids race conditions
# with partially-started workers.
#
# Requires:
#   - vastai CLI (configured with `vastai set api-key <key>`)
#   - jq, openssl, curl

set -euo pipefail

STATE="$HOME/.vast-font-gen"
LABEL="font-gen-server"
DEFAULT_GPU="RTX_4090"
DEFAULT_VRAM=16
DEFAULT_DISK=50

GPU="$DEFAULT_GPU"
VRAM="$DEFAULT_VRAM"
DISK="$DEFAULT_DISK"

while [ $# -gt 0 ]; do
  case "$1" in
    --gpu)   GPU="$2";  shift 2;;
    --vram)  VRAM="$2"; shift 2;;
    --disk)  DISK="$2"; shift 2;;
    -h|--help)
      sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

command -v vastai >/dev/null || { echo "vastai CLI not installed" >&2; exit 2; }
command -v jq     >/dev/null || { echo "jq required: brew install jq" >&2; exit 2; }

# Reuse existing instance if it is still alive.
if [ -f "$STATE" ]; then
  ID=$(jq -r '.id' "$STATE")
  if vastai show instance "$ID" --raw >/dev/null 2>&1; then
    URL=$(jq -r '.url' "$STATE")
    TOKEN=$(jq -r '.token' "$STATE")
    echo "[*] reusing existing instance $ID at $URL" >&2
    cat "$STATE"
    echo ""
    echo "[ACTION REQUIRED] Set on production server:"
    echo "  FONT_GEN_URL=$URL"
    echo "  FONT_GEN_TOKEN=$TOKEN"
    exit 0
  fi
  rm -f "$STATE"
fi

echo "[*] searching vast.ai for cheapest $GPU with >=${VRAM}GB VRAM..." >&2
OFFER=$(vastai search offers \
  "gpu_name=$GPU num_gpus=1 inet_down>=200 disk_space>=$DISK cuda_max_good>=12.4 verified=true rentable=true gpu_ram>=$VRAM" \
  --raw 2>/dev/null \
  | jq -r 'sort_by(.dph_total) | .[0].id')
[ -n "$OFFER" ] && [ "$OFFER" != "null" ] || { echo "no offers found" >&2; exit 3; }
echo "[*] selected offer $OFFER" >&2

TOKEN=$(openssl rand -hex 24)

# The onstart command fetches setup.sh from GitHub and runs it.
# FONT_GEN_TOKEN is the bearer token this instance requires on /generate.
ONSTART="export FONT_GEN_TOKEN='$TOKEN'; \
curl -fsSL https://raw.githubusercontent.com/Mrfocused1/freetools/main/tools/font-gen/server/setup.sh | bash > /var/log/onstart.log 2>&1"

CREATE=$(vastai create instance "$OFFER" \
  --image nvcr.io/nvidia/pytorch:24.10-py3 \
  --disk "$DISK" \
  --label "$LABEL" \
  --env "-p 8000:8000 -e FONT_GEN_TOKEN=$TOKEN" \
  --onstart-cmd "$ONSTART" \
  --raw 2>&1)

ID=$(echo "$CREATE" | jq -r '.new_contract // empty')
[ -n "$ID" ] || { echo "create failed: $CREATE" >&2; exit 4; }

echo "[*] provisioned instance $ID — setup takes ~8 min (MX-Font + deps)" >&2
echo "[*] tail logs: vastai logs $ID --tail 100" >&2

# Poll until the public IP+port are assigned.
URL=""
for i in $(seq 1 30); do
  INFO=$(vastai show instance "$ID" --raw 2>/dev/null || echo '{}')
  IP=$(echo "$INFO"   | jq -r '.public_ipaddr // empty')
  PORT=$(echo "$INFO" | jq -r '.ports["8000/tcp"][0].HostPort // empty' 2>/dev/null)
  if [ -n "$IP" ] && [ -n "$PORT" ]; then
    URL="http://$IP:$PORT"
    break
  fi
  echo "[*] waiting for public port… ($i/30)" >&2
  sleep 10
done
[ -n "$URL" ] || { echo "instance never got a public port" >&2; exit 5; }

# Poll /health until the worker is ready (pipeline loads MX-Font weights).
echo "[*] waiting for font-gen worker to pass /health at $URL ..." >&2
for i in $(seq 1 80); do
  if curl -fsS --max-time 8 "$URL/health" \
       -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1; then
    echo "[*] worker ready at $URL" >&2
    break
  fi
  echo "[*] still loading… ($i/80)" >&2
  sleep 15
done

# Persist state locally.
cat > "$STATE" <<EOF
{"id": $ID, "token": "$TOKEN", "url": "$URL"}
EOF
chmod 600 "$STATE"

echo ""
echo "===== font-gen worker is up ====="
cat "$STATE"
echo ""
echo "[ACTION REQUIRED] Set these env vars on the production server, then"
echo "restart the web container (docker compose up -d web):"
echo ""
echo "  FONT_GEN_URL=$URL"
echo "  FONT_GEN_TOKEN=$TOKEN"
echo ""
echo "To tear down:  tools/font-gen/scripts/font-gen-down.sh"

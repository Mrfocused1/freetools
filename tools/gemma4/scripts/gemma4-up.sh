#!/bin/bash
# Provision a vast.ai GPU instance running Gemma 4 via vLLM (OpenAI-compatible).
#
# Usage:
#   gemma4-up.sh [--model google/gemma-4-E4B-it] [--gpu RTX_4090] [--vram 16]
#
# State file: ~/.vast-gemma4 (instance id + api token)
# Saves: ~/.vast-gemma4 with {id, token, url, model}
#
# Requires:
#   - vastai CLI (configured)
#   - jq, openssl, curl, ssh
#   - HF_TOKEN env var (Gemma is gated; accept license on HuggingFace first)

set -euo pipefail

STATE="$HOME/.vast-gemma4"
LABEL="gemma4-server"
DEFAULT_MODEL="google/gemma-4-E4B-it"
DEFAULT_GPU="RTX_4090"
DEFAULT_VRAM=16

MODEL="$DEFAULT_MODEL"
GPU="$DEFAULT_GPU"
VRAM="$DEFAULT_VRAM"

while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2;;
    --gpu) GPU="$2"; shift 2;;
    --vram) VRAM="$2"; shift 2;;
    -h|--help)
      sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

command -v vastai >/dev/null || { echo "vastai CLI not installed" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq required: brew install jq" >&2; exit 2; }
[ -n "${HF_TOKEN:-}" ] || { echo "HF_TOKEN env var required (Gemma 4 is gated on HF)" >&2; exit 2; }

# If we already have a running instance, just reuse it.
if [ -f "$STATE" ]; then
  ID=$(jq -r '.id' "$STATE")
  if vastai show instance "$ID" --raw >/dev/null 2>&1; then
    URL=$(jq -r '.url' "$STATE")
    echo "[*] reusing existing instance $ID at $URL" >&2
    cat "$STATE"
    exit 0
  fi
  rm -f "$STATE"
fi

echo "[*] searching vast.ai for cheapest $GPU with ≥${VRAM}GB VRAM..." >&2
OFFER=$(vastai search offers \
  "gpu_name=$GPU num_gpus=1 inet_down>=200 disk_space>=40 cuda_max_good>=12.4 verified=true rentable=true gpu_ram>=$VRAM" \
  --raw 2>/dev/null \
  | jq -r 'sort_by(.dph_total) | .[0].id')
[ -n "$OFFER" ] && [ "$OFFER" != "null" ] || { echo "no offers found" >&2; exit 3; }
echo "[*] selected offer $OFFER" >&2

TOKEN=$(openssl rand -hex 16)
ONSTART="export API_TOKEN='$TOKEN' HF_TOKEN='$HF_TOKEN' GEMMA_MODEL='$MODEL'; \
curl -fsSL https://raw.githubusercontent.com/Mrfocused1/freetools/main/tools/gemma4/server/setup.sh | bash > /var/log/onstart.log 2>&1"

CREATE=$(vastai create instance "$OFFER" \
  --image pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime \
  --disk 40 \
  --label "$LABEL" \
  --env "-p 8000:8000 -e API_TOKEN=$TOKEN -e HF_TOKEN=$HF_TOKEN -e GEMMA_MODEL=$MODEL" \
  --onstart-cmd "$ONSTART" \
  --raw 2>&1)

ID=$(echo "$CREATE" | jq -r '.new_contract // empty')
[ -n "$ID" ] || { echo "create failed: $CREATE" >&2; exit 4; }

echo "[*] provisioned instance $ID — first boot takes ~5 min for model download" >&2
echo "[*] tailing logs: vastai logs $ID --tail 100" >&2

# Wait for the public IP/port to be assigned (instance state = running).
URL=""
for i in $(seq 1 30); do
  INFO=$(vastai show instance "$ID" --raw 2>/dev/null || echo '{}')
  IP=$(echo "$INFO" | jq -r '.public_ipaddr // empty')
  PORT=$(echo "$INFO" | jq -r '.ports["8000/tcp"][0].HostPort // empty' 2>/dev/null)
  if [ -n "$IP" ] && [ -n "$PORT" ]; then
    URL="http://$IP:$PORT"
    break
  fi
  sleep 10
done
[ -n "$URL" ] || { echo "instance never got a public port" >&2; exit 5; }

# Wait until vLLM responds on /v1/models.
echo "[*] waiting for vLLM to come up at $URL (model loading takes a few min)..." >&2
for i in $(seq 1 80); do
  if curl -fsS --max-time 5 "$URL/v1/models" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1; then
    echo "[*] ready at $URL" >&2
    break
  fi
  echo "[*] still loading… ($i/80)" >&2
  sleep 15
done

# Persist state.
cat > "$STATE" <<EOF
{"id": $ID, "token": "$TOKEN", "url": "$URL", "model": "$MODEL"}
EOF
chmod 600 "$STATE"
cat "$STATE"

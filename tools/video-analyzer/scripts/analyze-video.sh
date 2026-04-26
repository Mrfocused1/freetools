#!/bin/bash
# Analyze a video using a vast.ai GPU instance running Qwen2.5-VL-7B + Whisper.
#
# Usage:
#   analyze-video.sh <file-or-url> [--prompt "..."] [--keep-warm] [--destroy]
#
#   <file-or-url>   local file path OR https URL (incl. youtube/tiktok)
#   --prompt        override default narration prompt
#   --keep-warm     don't destroy instance after run (faster reuse, costs $/hr)
#   --destroy       just tear down any existing video-analyzer instance and exit
#
# State file: ~/.vast-video-analyzer  (stores instance id + bearer token)

set -euo pipefail

STATE="$HOME/.vast-video-analyzer"
LABEL="video-analyzer"

usage() {
  sed -n '3,11p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[ $# -ge 1 ] || usage

cmd="$1"; shift
KEEP_WARM=0
PROMPT=""
DESTROY_ONLY=0

if [ "$cmd" = "--destroy" ]; then
  DESTROY_ONLY=1
  INPUT=""
else
  INPUT="$cmd"
  while [ $# -gt 0 ]; do
    case "$1" in
      --keep-warm) KEEP_WARM=1; shift;;
      --destroy) DESTROY_ONLY=1; shift;;
      --prompt) PROMPT="$2"; shift 2;;
      -h|--help) usage;;
      *) echo "unknown arg: $1" >&2; usage;;
    esac
  done
fi

command -v vastai >/dev/null || { echo "vastai CLI not installed: pip install --upgrade vastai" >&2; exit 2; }
command -v jq >/dev/null     || { echo "jq required: brew install jq" >&2; exit 2; }
command -v curl >/dev/null   || { echo "curl required" >&2; exit 2; }

destroy_instance() {
  local id="$1"
  echo "[*] destroying instance $id..." >&2
  vastai destroy instance "$id" >/dev/null 2>&1 || true
  rm -f "$STATE"
}

# ---- destroy-only path ---------------------------------------------------
if [ "$DESTROY_ONLY" = "1" ]; then
  if [ -f "$STATE" ]; then
    ID=$(jq -r '.id' "$STATE")
    destroy_instance "$ID"
  fi
  # also nuke any orphan instances with our label
  vastai show instances --raw 2>/dev/null \
    | jq -r ".[] | select(.label==\"$LABEL\") | .id" \
    | while read -r oid; do destroy_instance "$oid"; done
  echo "[*] done."
  exit 0
fi

# ---- find or provision instance ----------------------------------------
INSTANCE_ID=""
TOKEN=""

if [ -f "$STATE" ]; then
  INSTANCE_ID=$(jq -r '.id' "$STATE")
  TOKEN=$(jq -r '.token' "$STATE")
  # verify still exists
  if ! vastai show instance "$INSTANCE_ID" --raw >/dev/null 2>&1; then
    echo "[*] saved instance $INSTANCE_ID is gone, will reprovision" >&2
    INSTANCE_ID=""
    rm -f "$STATE"
  fi
fi

if [ -z "$INSTANCE_ID" ]; then
  echo "[*] searching vast.ai for cheapest RTX 4090..." >&2
  OFFER=$(vastai search offers \
    'gpu_name=RTX_4090 num_gpus=1 inet_down>=200 disk_space>=50 cuda_max_good>=12.4 verified=true rentable=true' \
    --raw 2>/dev/null \
    | jq -r 'sort_by(.dph_total) | .[0].id')
  [ -n "$OFFER" ] && [ "$OFFER" != "null" ] || { echo "no 4090 offers found" >&2; exit 3; }
  echo "[*] selected offer $OFFER" >&2

  TOKEN=$(openssl rand -hex 16)
  ONSTART="export API_TOKEN='$TOKEN'; curl -fsSL https://raw.githubusercontent.com/Mrfocused1/freetools/main/tools/video-analyzer/setup.sh | bash > /var/log/onstart.log 2>&1"

  CREATE=$(vastai create instance "$OFFER" \
    --image pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime \
    --disk 50 \
    --label "$LABEL" \
    --env "-p 8000:8000 -e API_TOKEN=$TOKEN" \
    --onstart-cmd "$ONSTART" \
    --raw 2>&1)

  INSTANCE_ID=$(echo "$CREATE" | jq -r '.new_contract // empty')
  [ -n "$INSTANCE_ID" ] || { echo "create failed: $CREATE" >&2; exit 4; }

  echo "{\"id\": $INSTANCE_ID, \"token\": \"$TOKEN\"}" > "$STATE"
  chmod 600 "$STATE"
  echo "[*] provisioned instance $INSTANCE_ID — first cold start takes 5-10 min for model download" >&2
fi

# ---- wait for /health --------------------------------------------------
echo "[*] waiting for instance $INSTANCE_ID to be reachable..." >&2

URL=""
for i in $(seq 1 60); do
  INFO=$(vastai show instance "$INSTANCE_ID" --raw 2>/dev/null || echo '{}')
  STATUS=$(echo "$INFO" | jq -r '.actual_status // "?"')
  IP=$(echo "$INFO" | jq -r '.public_ipaddr // empty')
  PORT=$(echo "$INFO" | jq -r '.ports["8000/tcp"][0].HostPort // empty' 2>/dev/null)

  if [ -n "$IP" ] && [ -n "$PORT" ] && [ "$STATUS" = "running" ]; then
    URL="http://$IP:$PORT"
    if curl -fsS --max-time 5 "$URL/health" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1; then
      echo "[*] instance ready at $URL" >&2
      break
    fi
  fi
  echo "[*] attempt $i — status=$STATUS — still booting/loading models..." >&2
  sleep 15
done

[ -n "$URL" ] || { echo "instance never became reachable" >&2; exit 5; }

# Recheck health (it may need extra time loading models even after URL is up)
for i in $(seq 1 60); do
  if curl -fsS --max-time 5 "$URL/health" >/dev/null 2>&1; then
    break
  fi
  echo "[*] waiting for model load... ($i)" >&2
  sleep 15
done

# ---- send the job ------------------------------------------------------
echo "[*] sending job..." >&2
if [[ "$INPUT" =~ ^https?:// ]]; then
  ARGS=(-F "url=$INPUT")
else
  [ -f "$INPUT" ] || { echo "file not found: $INPUT" >&2; exit 6; }
  ARGS=(-F "file=@$INPUT")
fi
[ -n "$PROMPT" ] && ARGS+=(-F "prompt=$PROMPT")

curl -sS --max-time 1800 "$URL/analyze" \
  -H "Authorization: Bearer $TOKEN" \
  "${ARGS[@]}"
echo

if [ "$KEEP_WARM" = "0" ]; then
  destroy_instance "$INSTANCE_ID"
fi

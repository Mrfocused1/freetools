#!/usr/bin/env bash
# Start local development with an SSH tunnel to the Hetzner Redis.
# Uploads go to Supabase, jobs are enqueued to Hetzner Redis, the Hetzner
# worker processes them, results come back to your local browser. Full
# end-to-end without Docker or Python on your Mac.

set -euo pipefail

SERVER_IP="46.224.45.79"
SSH_KEY="$HOME/.ssh/quickfix_ed25519"
LOCAL_PORT=6380   # Use 6380 locally so it doesn't clash with any local redis.

cd "$(dirname "$0")/.."

# Kill any existing tunnel on this port.
if lsof -t -i tcp:$LOCAL_PORT >/dev/null 2>&1; then
  echo "[dev-start] Killing existing tunnel on :$LOCAL_PORT"
  lsof -t -i tcp:$LOCAL_PORT | xargs kill -9 2>/dev/null || true
  sleep 1
fi

echo "[dev-start] Opening SSH tunnel to $SERVER_IP (local :$LOCAL_PORT -> redis:6379)"
ssh -f -N \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o ServerAliveInterval=30 \
  -o ExitOnForwardFailure=yes \
  -i "$SSH_KEY" \
  -L "$LOCAL_PORT:localhost:6379" \
  "root@$SERVER_IP"

# Confirm it's up.
for i in 1 2 3 4 5; do
  if nc -z localhost $LOCAL_PORT 2>/dev/null; then break; fi
  sleep 1
done

# Pull the Redis password from the server's .env (via ssh) and write/refresh
# the REDIS_URL line in .env.local so the dev server can authenticate.
REDIS_PW=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$SSH_KEY" "root@$SERVER_IP" "grep '^REDIS_PASSWORD=' /opt/quickfix/.env | cut -d= -f2-")
if [ -z "$REDIS_PW" ]; then
  echo "[dev-start] ERROR: could not fetch Redis password from server"
  exit 1
fi

ENV_LOCAL="apps/web/.env.local"
NEW_REDIS_URL="redis://:${REDIS_PW}@localhost:${LOCAL_PORT}"

if grep -q '^REDIS_URL=' "$ENV_LOCAL"; then
  # macOS sed needs the '' for -i
  sed -i '' -E "s|^REDIS_URL=.*|REDIS_URL=${NEW_REDIS_URL}|" "$ENV_LOCAL"
else
  echo "REDIS_URL=${NEW_REDIS_URL}" >> "$ENV_LOCAL"
fi
echo "[dev-start] .env.local REDIS_URL points at localhost:${LOCAL_PORT}"

echo "[dev-start] Starting Next.js dev server on http://localhost:3000"
exec pnpm --filter web dev

#!/usr/bin/env bash
# Close the SSH tunnel started by dev-start.sh.
set -euo pipefail

LOCAL_PORT=6380

if lsof -t -i tcp:$LOCAL_PORT >/dev/null 2>&1; then
  echo "[dev-stop] Closing tunnel on :$LOCAL_PORT"
  lsof -t -i tcp:$LOCAL_PORT | xargs kill -9 2>/dev/null || true
else
  echo "[dev-stop] No tunnel running on :$LOCAL_PORT"
fi

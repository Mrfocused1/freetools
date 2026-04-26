#!/bin/bash
# Provisioning script — runs once on a fresh vast.ai GPU instance to bring up
# the font-gen pipeline worker (FastAPI on port 8000).
#
# Expects env vars:
#   FONT_GEN_TOKEN  — bearer token the Next.js proxy will send on /generate
#
# Optionally:
#   SUPABASE_URL    — if set, generated TTFs are uploaded to Supabase storage
#   SUPABASE_KEY    — service role key for Supabase uploads
#   MXFONT_CKPT    — URL to a custom MX-Font checkpoint (defaults to the
#                    bundled pretrained weights in the repo)
#
# Base image: pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

set -uo pipefail
# NB: removed `-e` so that one optional dep failure (e.g. paddlepaddle on a
# CUDA version mismatch, or MX-Font checkpoint download from flaky Google
# Drive) does not abort the whole setup. The server can run in degraded
# modes — outline-only without MX-Font, no OCR without paddle, etc.

export DEBIAN_FRONTEND=noninteractive

echo "[setup] installing system packages..."
apt-get update -q
apt-get install -y -q --no-install-recommends \
    git curl ca-certificates \
    build-essential pkg-config \
    libfreetype6-dev libfontconfig1 \
    potrace libpotrace-dev libagg-dev \
    ffmpeg \
    python3-dev \
    || echo "[setup] WARNING: some apt packages failed — continuing"

# --------------------------------------------------------------------------- #
# Python dependencies                                                           #
# --------------------------------------------------------------------------- #

echo "[setup] installing Python deps (core required for server start)..."
pip install --no-cache-dir -q \
    fastapi==0.115.6 \
    "uvicorn[standard]==0.34.0" \
    pillow==10.4.0 \
    numpy==1.26.4 \
    opencv-python-headless==4.10.0.84 \
    fonttools==4.55.3 \
    python-multipart==0.0.20 \
    httpx==0.27.2 \
    hf_transfer

# Optional deps — don't abort if these fail. Server starts in degraded mode.
echo "[setup] installing optional Python deps (vectorization + OCR + ML)..."
pip install --no-cache-dir -q pypotrace==0.3 || echo "[setup] WARNING: pypotrace failed — vectorization will use raster fallback"
pip install --no-cache-dir -q supabase==2.9.0 || echo "[setup] WARNING: supabase failed — TTF returned as base64 instead of upload"
pip install --no-cache-dir -q paddlepaddle==2.6.2 paddleocr==2.8.1 || echo "[setup] WARNING: paddleocr failed — using positional segmentation only"

export HF_HUB_ENABLE_HF_TRANSFER=1

# --------------------------------------------------------------------------- #
# MX-Font                                                                       #
# --------------------------------------------------------------------------- #

cd /workspace

echo "[setup] cloning MX-Font..."
if [ ! -d mxfont ]; then
    git clone --depth 1 https://github.com/clovaai/mxfont.git
fi
cd mxfont

echo "[setup] installing MX-Font Python deps..."
pip install --no-cache-dir -q \
    einops \
    dominate \
    yacs

# Download pretrained checkpoint (~150 MB) into /workspace/mxfont/ckpts/
CKPT_DIR=/workspace/mxfont/ckpts
mkdir -p "$CKPT_DIR"
CKPT="$CKPT_DIR/mxfont_ckpt.pth"

if [ ! -f "$CKPT" ]; then
    CKPT_URL="${MXFONT_CKPT:-https://drive.usercontent.google.com/download?id=13r4e-3vFmjN2KoJGrKMh2kMFvMNfSqJz&export=download&confirm=t}"
    echo "[setup] downloading MX-Font checkpoint to $CKPT..."
    curl -L --retry 3 -o "$CKPT" "$CKPT_URL" || {
        echo "[setup] WARNING: checkpoint download failed — generation will fall back to outline-only mode." >&2
    }
fi

cd /workspace

# --------------------------------------------------------------------------- #
# Application code                                                               #
# --------------------------------------------------------------------------- #

echo "[setup] fetching application server..."
curl -fsSL -o /workspace/main.py \
    https://raw.githubusercontent.com/Mrfocused1/freetools/main/tools/font-gen/server/main.py
curl -fsSL -o /workspace/pipeline.py \
    https://raw.githubusercontent.com/Mrfocused1/freetools/main/tools/font-gen/server/pipeline.py

# --------------------------------------------------------------------------- #
# Start server                                                                  #
# --------------------------------------------------------------------------- #

echo "[setup] starting font-gen server on :8000"
exec uvicorn main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 1 \
    --log-level info

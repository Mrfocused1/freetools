#!/bin/bash
# Provisioning script — runs once on a fresh vast.ai GPU instance.
#
# Expects env vars:
#   API_TOKEN  — bearer token the local CLI will send
#
# Base image must have CUDA + PyTorch + Python (e.g. pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime).

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "[setup] installing system packages..."
apt-get update -q
apt-get install -y -q --no-install-recommends ffmpeg git curl ca-certificates

cd /workspace
if [ ! -d freetools ]; then
  git clone --depth=1 https://github.com/Mrfocused1/freetools.git
fi
cp -r freetools/tools/video-analyzer ./video-analyzer
cd video-analyzer

echo "[setup] installing python deps..."
pip install --no-cache-dir -q -r requirements.txt hf_transfer

echo "[setup] pre-downloading models (Qwen2.5-VL-7B ~16GB, Whisper large-v3 ~3GB)..."
export HF_HUB_ENABLE_HF_TRANSFER=1
python - <<'PY'
from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor
print("downloading Qwen2.5-VL-7B-Instruct...", flush=True)
Qwen2_5_VLForConditionalGeneration.from_pretrained("Qwen/Qwen2.5-VL-7B-Instruct")
AutoProcessor.from_pretrained("Qwen/Qwen2.5-VL-7B-Instruct")
print("downloading Whisper large-v3...", flush=True)
from faster_whisper import WhisperModel
WhisperModel("large-v3", device="cuda", compute_type="float16")
print("done.", flush=True)
PY

echo "[setup] starting server on :8000"
exec uvicorn server:app --host 0.0.0.0 --port 8000

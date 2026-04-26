#!/bin/bash
# Provisioning script — runs once on a fresh vast.ai GPU instance to bring
# up a vLLM OpenAI-compatible server hosting Gemma 4.
#
# Expects env vars:
#   API_TOKEN   — bearer token the local agent will send
#   HF_TOKEN    — HuggingFace access token (required because Gemma 4 is gated)
#   GEMMA_MODEL — HF model id (default: google/gemma-4-E4B-it)
#   MAX_MODEL_LEN — context window cap (default: 8192)
#
# Base image: pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime (or similar with CUDA 12+)

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "[setup] installing system packages..."
apt-get update -q
apt-get install -y -q --no-install-recommends git curl ca-certificates

cd /workspace

echo "[setup] installing vLLM + hf_transfer..."
pip install --no-cache-dir -q "vllm>=0.7.0" hf_transfer

export HF_HUB_ENABLE_HF_TRANSFER=1
export HF_TOKEN="${HF_TOKEN:-}"
export HUGGING_FACE_HUB_TOKEN="${HF_TOKEN:-}"

MODEL="${GEMMA_MODEL:-google/gemma-4-E4B-it}"
MAX_LEN="${MAX_MODEL_LEN:-8192}"
TOKEN="${API_TOKEN:?API_TOKEN env must be set}"

echo "[setup] starting vLLM server with $MODEL (max_model_len=$MAX_LEN)"
exec python -m vllm.entrypoints.openai.api_server \
    --model "$MODEL" \
    --api-key "$TOKEN" \
    --host 0.0.0.0 \
    --port 8000 \
    --max-model-len "$MAX_LEN" \
    --gpu-memory-utilization 0.92 \
    --download-dir /workspace/models

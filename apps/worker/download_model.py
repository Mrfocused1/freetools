"""Pre-download BiRefNet weights so runtime startup is fast."""
import os
import shutil
from huggingface_hub import snapshot_download, hf_hub_download

cache_dir = os.environ.get("MODEL_CACHE_DIR", "/root/.cache/huggingface")
device = os.environ.get("DEVICE", "cuda").lower()

# PyTorch weights.
# CPU: lite (fast mode) + matting (fine hair mode, same BiRefNet architecture but
#      fine-tuned for alpha matting — much better on fine hair and fur edges).
# GPU: full BiRefNet + 2K variant.
if device == "cpu":
    pt_repos = [
        "ZhengPeng7/BiRefNet_lite",
        "ZhengPeng7/BiRefNet-matting",
    ]
else:
    pt_repos = [
        "ZhengPeng7/BiRefNet",
        "ZhengPeng7/BiRefNet_lite-2K",
        "ZhengPeng7/BiRefNet-matting",
    ]

for repo in pt_repos:
    print(f"Downloading PyTorch weights: {repo}", flush=True)
    snapshot_download(
        repo_id=repo,
        cache_dir=cache_dir,
        allow_patterns=["*.json", "*.safetensors", "*.py", "*.txt"],
    )

# Swin2SR upscaler weights.
for upscaler_repo in [
    "caidas/swin2SR-lightweight-x2-64",
    "caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr",
]:
    print(f"Downloading upscaler weights: {upscaler_repo}", flush=True)
    try:
        snapshot_download(
            repo_id=upscaler_repo,
            cache_dir=cache_dir,
            allow_patterns=["*.json", "*.safetensors", "*.bin", "*.txt"],
        )
    except Exception as e:
        print(f"Skipping {upscaler_repo}: {e}", flush=True)

# NOTE: Pre-converted ONNX download was removed because onnx-community/BiRefNet-ONNX
# ships the FULL BiRefNet (~970 MB), which OOMs on a CX33. The PyTorch path uses the
# much smaller BiRefNet_lite (~180 MB) and is the right default for a small CPU box.
# If we ever upgrade to a larger Hetzner or move to vast.ai GPU, the ONNX fast path
# in inference.py auto-activates when the ONNX file exists.

print("Model download done.", flush=True)

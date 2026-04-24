"""BiRefNet inference on CPU or GPU.

Model: https://github.com/ZhengPeng7/BiRefNet (MIT).
On CPU we use BiRefNet_lite (SwinT backbone) — ~6x smaller than the full model,
fast enough for a shared CX33.
"""
from __future__ import annotations

import io
import os
from dataclasses import dataclass
from typing import Literal

import numpy as np
import torch
from PIL import Image, ImageFilter
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

ModelName = Literal[
    "birefnet",            # default, fast on CPU
    "birefnet-2k",         # full-resolution GPU
    "birefnet+vitmatte",   # legacy alias, routed to matting model
    "birefnet-matting",    # fine hair / alpha-matting variant
]

_MODEL_REPO_GPU = {
    "birefnet": "ZhengPeng7/BiRefNet",
    "birefnet-2k": "ZhengPeng7/BiRefNet_lite-2K",
    "birefnet-matting": "ZhengPeng7/BiRefNet-matting",
    "birefnet+vitmatte": "ZhengPeng7/BiRefNet-matting",
}
# On CPU: "birefnet" → lite (fast). "birefnet-matting" → matting variant (slower,
# much better on hair). 2K variant on CPU still uses lite because full-res is
# impractical on CPU anyway.
_MODEL_REPO_CPU = {
    "birefnet": "ZhengPeng7/BiRefNet_lite",
    "birefnet-2k": "ZhengPeng7/BiRefNet_lite",
    "birefnet-matting": "ZhengPeng7/BiRefNet-matting",
    "birefnet+vitmatte": "ZhengPeng7/BiRefNet-matting",
}
_INPUT_RESOLUTION = {
    "birefnet": 1024,
    "birefnet-2k": 2048,
    "birefnet-matting": 1024,
    "birefnet+vitmatte": 1024,
}


@dataclass
class LoadedModel:
    model: torch.nn.Module
    resolution: int
    name: ModelName


class InferenceEngine:
    def __init__(self, device: str = "cuda"):
        self.device = device if torch.cuda.is_available() and device == "cuda" else "cpu"
        # Use as many threads as PyTorch will allow on CPU.
        if self.device == "cpu":
            torch.set_num_threads(max(1, os.cpu_count() or 1))
        self._cache: dict[ModelName, LoadedModel] = {}
        self._normalize = transforms.Normalize(
            mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]
        )

    def _load(self, name: ModelName) -> LoadedModel:
        if name in self._cache:
            return self._cache[name]
        repo_map = _MODEL_REPO_CPU if self.device == "cpu" else _MODEL_REPO_GPU
        repo = repo_map[name]
        # Lower input resolution on CPU — otherwise 2K inference is minutes.
        resolution = _INPUT_RESOLUTION[name] if self.device == "cuda" else 1024
        model = AutoModelForImageSegmentation.from_pretrained(
            repo, trust_remote_code=True
        )
        model.eval()
        if self.device == "cuda":
            model.half().to(self.device)
        else:
            model.to(self.device)
        loaded = LoadedModel(model=model, resolution=resolution, name=name)
        self._cache[name] = loaded
        return loaded

    def warmup(self):
        """Load default model at startup."""
        self._load("birefnet")

    @torch.inference_mode()
    def remove_background(
        self,
        image_bytes: bytes,
        model: ModelName = "birefnet",
        max_output_dimension: int = 0,
        feather_radius: float = 0.8,
        auto_crop: bool = False,
    ) -> bytes:
        """Return PNG bytes with a transparent background."""
        loaded = self._load(model)
        pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        orig_w, orig_h = pil.size

        resized = pil.resize(
            (loaded.resolution, loaded.resolution), Image.Resampling.BILINEAR
        )
        tensor = transforms.functional.to_tensor(resized)
        tensor = self._normalize(tensor).unsqueeze(0)
        if self.device == "cuda":
            tensor = tensor.half().to(self.device)
        else:
            tensor = tensor.to(self.device)

        if self.device == "cuda":
            with torch.amp.autocast(device_type="cuda", enabled=True):
                preds = loaded.model(tensor)
        else:
            preds = loaded.model(tensor)

        mask = preds[-1].sigmoid() if isinstance(preds, (list, tuple)) else preds.sigmoid()
        mask = mask[0, 0].float().cpu().numpy()  # [H, W] in [0, 1]

        mask_img = Image.fromarray((mask * 255).astype(np.uint8), mode="L").resize(
            (orig_w, orig_h), Image.Resampling.BILINEAR
        )
        # Feather softens hard edges. Skip the blur entirely if radius == 0 so that
        # users wanting razor-sharp product cutouts get them.
        if feather_radius > 0:
            mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=feather_radius))

        rgba = pil.convert("RGBA")
        rgba.putalpha(mask_img)

        # Auto-crop: tight bounding box around alpha>8, +5% padding on each side.
        if auto_crop:
            mask_np = np.array(mask_img)
            ys, xs = np.where(mask_np > 8)
            if len(xs) and len(ys):
                x0, x1 = xs.min(), xs.max()
                y0, y1 = ys.min(), ys.max()
                w = x1 - x0
                h = y1 - y0
                pad_x = max(1, int(w * 0.05))
                pad_y = max(1, int(h * 0.05))
                x0 = max(0, x0 - pad_x)
                y0 = max(0, y0 - pad_y)
                x1 = min(rgba.size[0], x1 + pad_x)
                y1 = min(rgba.size[1], y1 + pad_y)
                rgba = rgba.crop((x0, y0, x1, y1))

        if max_output_dimension > 0:
            longest = max(rgba.size)
            if longest > max_output_dimension:
                scale = max_output_dimension / longest
                new_size = (round(rgba.size[0] * scale), round(rgba.size[1] * scale))
                rgba = rgba.resize(new_size, Image.Resampling.LANCZOS)

        out = io.BytesIO()
        rgba.save(out, format="PNG", optimize=True)
        return out.getvalue()

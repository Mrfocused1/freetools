"""Image super-resolution via Swin2SR — single-pass on CPU."""
from __future__ import annotations

import io
import os
from dataclasses import dataclass
from typing import Literal

import numpy as np
import torch
from PIL import Image

UpscaleFactor = Literal[2, 4]

_MODEL_REPO = {
    2: "caidas/swin2SR-lightweight-x2-64",
    4: "caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr",
}

# Caps to keep CPU inference within memory/time bounds on a CX33.
# Longest-side of input (we downscale before processing if larger).
_MAX_INPUT_SIDE = {
    2: 768,
    4: 384,
}


@dataclass
class _Loaded:
    processor: object
    model: object
    scale: int


class UpscaleEngine:
    def __init__(self, device: str = "cpu"):
        self.device = device if (device == "cuda" and torch.cuda.is_available()) else "cpu"
        self._cache: dict[int, _Loaded] = {}
        if self.device == "cpu":
            torch.set_num_threads(max(1, os.cpu_count() or 1))

    def _load(self, scale: UpscaleFactor) -> _Loaded:
        if scale in self._cache:
            return self._cache[scale]
        from transformers import Swin2SRForImageSuperResolution, Swin2SRImageProcessor
        repo = _MODEL_REPO[scale]
        processor = Swin2SRImageProcessor.from_pretrained(repo)
        model = Swin2SRForImageSuperResolution.from_pretrained(repo)
        model.eval()
        model.to(self.device)
        self._cache[scale] = _Loaded(processor=processor, model=model, scale=scale)
        return self._cache[scale]

    def warmup(self, scale: UpscaleFactor = 2):
        self._load(scale)

    @torch.inference_mode()
    def upscale(
        self,
        image_bytes: bytes,
        scale: UpscaleFactor = 2,
    ) -> bytes:
        loaded = self._load(scale)
        pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        max_side = _MAX_INPUT_SIDE[scale]
        w, h = pil.size
        if max(w, h) > max_side:
            ratio = max_side / max(w, h)
            pil = pil.resize((max(1, int(w * ratio)), max(1, int(h * ratio))), Image.Resampling.LANCZOS)

        inputs = loaded.processor(images=pil, return_tensors="pt")
        pixel_values = inputs["pixel_values"].to(self.device)

        out = loaded.model(pixel_values)
        # out.reconstruction: [B, 3, H', W'] float in ~[0, 1]
        rec = out.reconstruction[0].clamp(0, 1).cpu().numpy().transpose(1, 2, 0)
        arr = (rec * 255).astype(np.uint8)

        result = Image.fromarray(arr, mode="RGB")
        buf = io.BytesIO()
        result.save(buf, format="PNG", optimize=True)
        return buf.getvalue()

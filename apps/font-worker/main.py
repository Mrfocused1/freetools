"""Font Identifier worker — Phase 1 (identification only).

Receives an uploaded image, extracts the text region using Otsu thresholding,
computes a CLIP embedding, and returns the top-K closest fonts from a pre-built
numpy index.

POST /api/font-clone/identify
  Authorization: Bearer <FONT_TOKEN>
  Content-Type: multipart/form-data
  file: <image file (PNG/JPEG/WebP, max 10 MB)>
  → {
      "matches": [
        {
          "family": "Roboto",
          "style": "Regular",
          "source": "google",
          "license": "Apache-2.0",
          "score": 0.92,
          "previewUrl": "https://fonts.gstatic.com/...",
          "downloadUrl": "https://fonts.google.com/specimen/Roboto"
        },
        ...
      ]
    }

GET /health → { "ok": true, "indexed_fonts": N }
"""

from __future__ import annotations

import io
import json
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageFilter, ImageOps

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

FONT_TOKEN = os.environ["FONT_TOKEN"]
INDEX_DIR = Path(os.environ.get("INDEX_DIR", "/data"))
INDEX_NPZ = INDEX_DIR / "font_index.npz"
INDEX_JSON = INDEX_DIR / "font_index.json"

TOP_K = 5
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
RENDER_HEIGHT = 96  # pixels; image is resized to this height before embedding

# --------------------------------------------------------------------------- #
# CLIP model — loaded once at startup                                          #
# --------------------------------------------------------------------------- #
# Delay-import torch/transformers so the module can be imported for testing    #
# without requiring the full ML stack.                                         #

_clip_model = None
_clip_processor = None


def _load_clip() -> None:
    global _clip_model, _clip_processor
    if _clip_model is not None:
        return
    log.info("Loading CLIP model openai/clip-vit-base-patch32 …")
    from transformers import CLIPModel, CLIPProcessor  # noqa: PLC0415

    _clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    _clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    _clip_model.eval()
    log.info("CLIP model loaded.")


def _embed_image(img: Image.Image) -> np.ndarray:
    """Return a unit-normed CLIP image embedding (shape [512])."""
    import torch  # noqa: PLC0415

    _load_clip()
    inputs = _clip_processor(images=img, return_tensors="pt")
    with torch.no_grad():
        feats = _clip_model.get_image_features(**inputs)
    vec = feats[0].cpu().numpy().astype(np.float32)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec /= norm
    return vec


# --------------------------------------------------------------------------- #
# Font index — loaded once at startup                                          #
# --------------------------------------------------------------------------- #

_font_vectors: np.ndarray | None = None  # shape [N, 512]
_font_meta: list[dict[str, Any]] = []


def _load_index() -> None:
    global _font_vectors, _font_meta
    if _font_vectors is not None:
        return
    if not INDEX_NPZ.exists() or not INDEX_JSON.exists():
        log.warning(
            "Font index not found at %s. Run build_index.py once to populate it. "
            "The /health endpoint will report indexed_fonts=0 until then.",
            INDEX_DIR,
        )
        _font_vectors = np.empty((0, 512), dtype=np.float32)
        _font_meta = []
        return

    log.info("Loading font index from %s …", INDEX_DIR)
    data = np.load(str(INDEX_NPZ))
    _font_vectors = data["vectors"].astype(np.float32)
    with open(INDEX_JSON, encoding="utf-8") as f:
        _font_meta = json.load(f)
    log.info("Loaded %d font variants into memory.", len(_font_meta))


# --------------------------------------------------------------------------- #
# Image pre-processing                                                         #
# --------------------------------------------------------------------------- #


def _preprocess(raw: bytes) -> Image.Image:
    """Convert uploaded image bytes → a preprocessed text-region crop.

    Strategy:
    1. Decode image (any format PIL supports).
    2. Convert to grayscale.
    3. Auto-levels (stretch contrast so dark text becomes black on white).
    4. Otsu-approximate threshold: pixels below the median become black (text),
       others become white (background). We then invert if needed so text is
       always dark on light.
    5. Tight-crop to the bounding box of dark pixels (the text region).
    6. Resize to RENDER_HEIGHT px tall (preserve aspect ratio), pad to square.
    """
    img = Image.open(io.BytesIO(raw)).convert("RGB")

    # Grayscale + auto-levels
    gray = ImageOps.grayscale(img)
    gray = ImageOps.autocontrast(gray, cutoff=2)

    # Threshold: pixels below median → 0 (text), rest → 255 (bg)
    arr = np.array(gray, dtype=np.uint8)
    threshold = int(np.median(arr))
    binary = (arr > threshold).astype(np.uint8) * 255  # 255 = bg, 0 = text

    # If more pixels are dark than light, the image is already dark-on-light
    # (which is what we want after the above). If the text appears light on dark,
    # invert so text is always dark.
    dark_fraction = np.mean(binary == 0)
    if dark_fraction > 0.5:
        # More dark pixels than light → text is large/bold or image is inverted;
        # flip so we always pass dark-text-on-light to CLIP.
        binary = 255 - binary

    bin_img = Image.fromarray(binary, mode="L")

    # Tight-crop to bounding box of dark pixels
    bbox = bin_img.getbbox()
    if bbox is None:
        # Fallback: use the whole image resized
        cropped = img
    else:
        # Add 4 px padding around the text region
        x0 = max(0, bbox[0] - 4)
        y0 = max(0, bbox[1] - 4)
        x1 = min(bin_img.width, bbox[2] + 4)
        y1 = min(bin_img.height, bbox[3] + 4)
        cropped = img.crop((x0, y0, x1, y1))

    # Resize so height = RENDER_HEIGHT px; preserve aspect ratio
    w, h = cropped.size
    if h == 0:
        h = 1
    new_w = max(1, int(w * RENDER_HEIGHT / h))
    resized = cropped.resize((new_w, RENDER_HEIGHT), Image.LANCZOS)

    # Pad to a square for CLIP (CLIP expects 224×224; the processor handles that,
    # but a roughly-square input reduces distortion)
    side = max(new_w, RENDER_HEIGHT)
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    canvas.paste(resized, ((side - new_w) // 2, (side - RENDER_HEIGHT) // 2))

    return canvas


# --------------------------------------------------------------------------- #
# FastAPI app                                                                  #
# --------------------------------------------------------------------------- #

app = FastAPI(title="font-worker", version="1.0.0")


@app.on_event("startup")
async def startup() -> None:
    _load_index()
    # Pre-load CLIP model so first request is fast.
    # If the index is empty we still load the model so health checks work.
    try:
        _load_clip()
    except Exception as exc:  # pragma: no cover
        log.error("CLIP model failed to load: %s — identifications will fail.", exc)


def _check_auth(authorization: str | None) -> None:
    if not authorization or authorization != f"Bearer {FONT_TOKEN}":
        raise HTTPException(status_code=401, detail="invalid token")


@app.get("/health")
async def health() -> dict[str, Any]:
    n = len(_font_meta) if _font_meta else 0
    return {"ok": True, "indexed_fonts": n}


@app.post("/api/font-clone/identify")
async def identify(
    file: UploadFile,
    authorization: str | None = Header(None),
) -> JSONResponse:
    _check_auth(authorization)

    # ---- Validate upload ------------------------------------------------- #
    raw = await file.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")

    try:
        processed = _preprocess(raw)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Cannot decode image: {exc}") from exc

    # ---- Embed ----------------------------------------------------------- #
    try:
        query_vec = _embed_image(processed)  # [512]
    except Exception as exc:
        log.exception("CLIP embed failed")
        raise HTTPException(status_code=500, detail=f"Embedding failed: {exc}") from exc

    # ---- Search ---------------------------------------------------------- #
    if _font_vectors is None or len(_font_vectors) == 0:
        raise HTTPException(
            status_code=503,
            detail=(
                "Font index is empty. Run build_index.py on the server to populate it "
                "(see deployment docs)."
            ),
        )

    # Cosine similarity: both query and index vectors are unit-normed at build time.
    # scores shape: [N]
    scores: np.ndarray = _font_vectors @ query_vec  # dot product = cosine sim
    top_idx = np.argsort(scores)[::-1][:TOP_K]

    matches = []
    for idx in top_idx:
        meta = _font_meta[idx]
        score = float(scores[idx])
        matches.append(
            {
                "family": meta.get("family", "Unknown"),
                "style": meta.get("style", "Regular"),
                "source": meta.get("source", "unknown"),
                "license": meta.get("license", ""),
                "score": round(score, 4),
                "previewUrl": meta.get("previewUrl", ""),
                "downloadUrl": meta.get("downloadUrl", ""),
            }
        )

    return JSONResponse({"matches": matches})

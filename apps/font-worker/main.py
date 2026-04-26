"""Font Identifier worker — Phase 3 (per-character glyph matching).

Phase 3 improvement over Phase 1:
  - The index stores one CLIP embedding per glyph (A-Z, a-z, 0-9) per font
    (~62 entries/font) instead of 3 whole-string samples.
  - At query time we segment the uploaded image into individual character
    bounding boxes (cv2 connectedComponents), embed each character crop, find
    its nearest glyph in the index, and aggregate votes by font_id.
  - The font with the most "winning" characters (highest total similarity mass)
    is ranked first. This is fundamentally more accurate than string-level
    matching because CLIP compares like-for-like glyphs.

Backwards compatibility:
  - The /api/font-clone/identify endpoint contract is unchanged.
  - The index format (NPZ vectors + JSON meta) is unchanged; only a new "char"
    field is added per entry. Old indexes without "char" still load fine and the
    code falls back to the legacy max-score-per-font grouping automatically.

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
from PIL import Image, ImageOps

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

FONT_TOKEN = os.environ["FONT_TOKEN"]
INDEX_DIR = Path(os.environ.get("INDEX_DIR", "/data"))
INDEX_NPZ = INDEX_DIR / "font_index.npz"
INDEX_JSON = INDEX_DIR / "font_index.json"

TOP_K = 5
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
RENDER_HEIGHT = 96  # pixels; image is resized to this height before embedding

# Per-character segmentation tunables
MIN_CHAR_AREA = 20         # ignore blobs smaller than this (noise)
MAX_CHAR_ASPECT = 8.0      # ignore very wide blobs (likely not single chars)
GLYPH_CANVAS_SIZE = 80     # square canvas size for individual char crops (matches build_index.py)
CHAR_PADDING = 4           # px padding around each char bounding box crop

# Voting: for each segmented char, we find its TOP_CHARS_PER_CHAR nearest index
# entries and add their cosine scores as votes. Using top-N rather than top-1
# makes the vote more robust to imperfect segmentation.
TOP_CHARS_PER_CHAR = 3


# --------------------------------------------------------------------------- #
# CLIP model — loaded once at startup                                          #
# --------------------------------------------------------------------------- #

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
_index_mode: str = "legacy"  # "glyph" or "legacy"


def _load_index() -> None:
    global _font_vectors, _font_meta, _index_mode
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
        _index_mode = "legacy"
        return

    log.info("Loading font index from %s …", INDEX_DIR)
    data = np.load(str(INDEX_NPZ))
    _font_vectors = data["vectors"].astype(np.float32)
    with open(INDEX_JSON, encoding="utf-8") as f:
        _font_meta = json.load(f)

    # Detect index mode: Phase 3 indexes have a "char" field on entries.
    if _font_meta and "char" in _font_meta[0]:
        _index_mode = "glyph"
        log.info("Loaded %d glyph entries (Phase 3 glyph index).", len(_font_meta))
    else:
        _index_mode = "legacy"
        log.info("Loaded %d font variants (legacy Phase 1 index — rebuild recommended).", len(_font_meta))


# --------------------------------------------------------------------------- #
# Image pre-processing (shared)                                                #
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
        binary = 255 - binary

    bin_img = Image.fromarray(binary, mode="L")

    # Tight-crop to bounding box of dark pixels
    bbox = bin_img.getbbox()
    if bbox is None:
        cropped = img
    else:
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

    # Pad to a square for CLIP
    side = max(new_w, RENDER_HEIGHT)
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    canvas.paste(resized, ((side - new_w) // 2, (side - RENDER_HEIGHT) // 2))

    return canvas


# --------------------------------------------------------------------------- #
# Character segmentation (Phase 3)                                             #
# --------------------------------------------------------------------------- #


def _segment_chars(raw: bytes) -> list[Image.Image]:
    """Segment uploaded image into individual character crops using cv2.

    Returns a list of PIL Image crops (one per detected character), centred on
    a GLYPH_CANVAS_SIZE square canvas — the same framing used in build_index.py.

    Falls back to returning the full preprocessed image in a list if cv2 is not
    available or segmentation yields fewer than 2 characters.
    """
    try:
        import cv2  # noqa: PLC0415
    except ImportError:
        log.debug("cv2 not available; falling back to whole-image embedding.")
        return [_preprocess(raw)]

    img_pil = Image.open(io.BytesIO(raw)).convert("RGB")
    gray_pil = ImageOps.grayscale(img_pil)
    gray_pil = ImageOps.autocontrast(gray_pil, cutoff=2)
    arr = np.array(gray_pil, dtype=np.uint8)

    # Otsu threshold via cv2 for more robust binarisation
    _, binary = cv2.threshold(arr, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)

    # Ensure text is white on black for connectedComponents
    dark_fraction = np.mean(binary == 0)
    if dark_fraction < 0.5:
        binary = 255 - binary

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)

    img_w, img_h = img_pil.size
    crops: list[Image.Image] = []

    for label in range(1, num_labels):  # skip background (label 0)
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        area = int(stats[label, cv2.CC_STAT_AREA])

        if area < MIN_CHAR_AREA:
            continue
        aspect = max(w, h) / max(min(w, h), 1)
        if aspect > MAX_CHAR_ASPECT:
            continue
        # Discard blobs that are clearly not characters (too small relative to image)
        if h < img_h * 0.05 or w < img_w * 0.005:
            continue

        # Crop with padding
        x0 = max(0, x - CHAR_PADDING)
        y0 = max(0, y - CHAR_PADDING)
        x1 = min(img_w, x + w + CHAR_PADDING)
        y1 = min(img_h, y + h + CHAR_PADDING)
        char_crop = img_pil.crop((x0, y0, x1, y1))

        # Centre on a square canvas matching the build_index.py format
        cw, ch = char_crop.size
        side = max(cw, ch, GLYPH_CANVAS_SIZE)
        canvas = Image.new("RGB", (side, side), (255, 255, 255))
        canvas.paste(char_crop, ((side - cw) // 2, (side - ch) // 2))

        crops.append(canvas)

    if len(crops) < 2:
        # Segmentation failed or image has very few glyphs; fall back to whole image
        log.debug("Character segmentation yielded %d crops; falling back to whole-image.", len(crops))
        return [_preprocess(raw)]

    log.debug("Segmented %d character crops.", len(crops))
    return crops


# --------------------------------------------------------------------------- #
# Voting search (Phase 3 glyph index)                                          #
# --------------------------------------------------------------------------- #


def _search_glyph(char_crops: list[Image.Image]) -> list[tuple[float, int]]:
    """Embed each char crop, find nearest glyph entries, vote by font_id.

    Returns list of (score, best_meta_idx) sorted by score descending, one per
    unique font_id (same shape as the legacy _search_legacy output).
    """
    assert _font_vectors is not None

    # Accumulate vote scores per font key.
    # For each character crop, find top-N nearest index entries and add their
    # cosine similarities as votes. The font_id with the highest total vote wins.
    vote_score: dict[str, float] = {}
    vote_meta_idx: dict[str, int] = {}  # track the best-scoring meta entry per font

    for crop in char_crops:
        try:
            q = _embed_image(crop)  # [512]
        except Exception as exc:
            log.warning("Embed failed for char crop: %s", exc)
            continue

        sims: np.ndarray = _font_vectors @ q  # [N] cosine similarities

        # Take top-N entries
        k = min(TOP_CHARS_PER_CHAR, len(sims))
        top_idxs = np.argpartition(sims, -k)[-k:]
        top_idxs = top_idxs[np.argsort(-sims[top_idxs])]

        for idx in top_idxs:
            meta = _font_meta[idx]
            key = meta.get("id") or f"{meta.get('family','?')}::{meta.get('style','?')}"
            score = float(sims[idx])
            vote_score[key] = vote_score.get(key, 0.0) + score
            # Track the meta entry with the highest individual score for this font
            if key not in vote_meta_idx or score > float(_font_vectors[vote_meta_idx[key]] @ q):
                vote_meta_idx[key] = int(idx)

    # Normalise vote scores to [0, 1] by dividing by number of char crops so
    # the returned "score" field is still roughly cosine-similarity-like.
    n_crops = max(len(char_crops), 1)
    ranked = sorted(vote_score.keys(), key=lambda k: vote_score[k], reverse=True)[:TOP_K]
    return [(vote_score[k] / n_crops, vote_meta_idx[k]) for k in ranked]


# --------------------------------------------------------------------------- #
# Legacy search (Phase 1 index — max cosine per font)                         #
# --------------------------------------------------------------------------- #


def _search_legacy(query_vec: np.ndarray) -> list[tuple[float, int]]:
    """Original search: max cosine score per (family, style) group."""
    assert _font_vectors is not None
    scores: np.ndarray = _font_vectors @ query_vec

    best_by_key: dict[str, tuple[float, int]] = {}
    for idx in range(len(scores)):
        meta = _font_meta[idx]
        key = meta.get("id") or f"{meta.get('family','?')}::{meta.get('style','?')}"
        s = float(scores[idx])
        prev = best_by_key.get(key)
        if prev is None or s > prev[0]:
            best_by_key[key] = (s, idx)

    ranked = sorted(best_by_key.values(), key=lambda x: x[0], reverse=True)[:TOP_K]
    return ranked


# --------------------------------------------------------------------------- #
# FastAPI app                                                                  #
# --------------------------------------------------------------------------- #

app = FastAPI(title="font-worker", version="3.0.0")


@app.on_event("startup")
async def startup() -> None:
    _load_index()
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
    # Report unique fonts, not glyph entries, for a meaningful count
    if _index_mode == "glyph" and _font_meta:
        unique_fonts = len({m.get("id") for m in _font_meta})
        return {"ok": True, "indexed_fonts": unique_fonts, "index_mode": _index_mode,
                "total_glyph_entries": n}
    return {"ok": True, "indexed_fonts": n, "index_mode": _index_mode}


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
        # Always validate the image is decodeable
        Image.open(io.BytesIO(raw)).verify()
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Cannot decode image: {exc}") from exc

    # ---- Search ---------------------------------------------------------- #
    if _font_vectors is None or len(_font_vectors) == 0:
        raise HTTPException(
            status_code=503,
            detail=(
                "Font index is empty. Run build_index.py on the server to populate it "
                "(see deployment docs)."
            ),
        )

    try:
        if _index_mode == "glyph":
            # Phase 3: segment chars, embed each, vote by font_id
            char_crops = _segment_chars(raw)
            ranked = _search_glyph(char_crops)
        else:
            # Legacy Phase 1: whole-image embed + max cosine per font
            processed = _preprocess(raw)
            query_vec = _embed_image(processed)
            ranked = _search_legacy(query_vec)
    except Exception as exc:
        log.exception("Search failed")
        raise HTTPException(status_code=500, detail=f"Search failed: {exc}") from exc

    # ---- Format response ------------------------------------------------- #
    matches = []
    for score, idx in ranked:
        meta = _font_meta[idx]
        matches.append(
            {
                "family": meta.get("family", "Unknown"),
                "style": meta.get("style", "Regular"),
                "source": meta.get("source", "unknown"),
                "license": meta.get("license", ""),
                "score": round(float(score), 4),
                "previewUrl": meta.get("previewUrl", ""),
                "downloadUrl": meta.get("downloadUrl", ""),
            }
        )

    return JSONResponse({"matches": matches})

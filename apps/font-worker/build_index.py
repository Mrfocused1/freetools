"""Font index builder — streaming from the Fontsource CDN.

Earlier version cloned google/fonts (~5 GB) and fontsource/font-files (~8 GB)
to local disk, which exceeded the CX33's 38 GB capacity. This version streams
each TTF directly from https://cdn.jsdelivr.net/fontsource/fonts (the Fontsource
package CDN, which mirrors Google Fonts AND Font Squirrel-licensed open fonts
under a unified naming scheme).

For each font:
  1. List families from https://api.fontsource.org/v1/fonts (single API call,
     returns ~2,000 fonts with id/family/weights/styles/license)
  2. Pick the first available weight from a preference list (400, 700, 300, …)
  3. Download just that TTF to memory via httpx (~50-300 KB per font)
  4. Render the sample text with PIL
  5. Compute CLIP image embedding
  6. Discard the bytes — never written to disk
  7. Append to checkpoint every CHECKPOINT_INTERVAL fonts (resumable)
  8. At the end, write final font_index.npz + font_index.json to /data

Peak disk usage: under 100 MB (just /data + the in-memory checkpoint flush).
ETA: ~2 hours on a 4-core CPU for ~2,000 fonts.

Run inside the container:
    docker compose run --rm font-worker python build_index.py
"""
from __future__ import annotations

import io
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageFont

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

INDEX_DIR = Path(os.environ.get("INDEX_DIR", "/data"))
INDEX_NPZ = INDEX_DIR / "font_index.npz"
INDEX_JSON = INDEX_DIR / "font_index.json"
CHECKPOINT_FILE = INDEX_DIR / "build_checkpoint.json"

# Tunables
# We embed each font under several text variants so that at query time we can
# match against whichever variant is most similar to the user's input
# (lowercase-only? all caps? mixed?). Per-variant similarity is later max'd
# per-font in main.py, which dramatically improves match quality vs a single
# fixed sample text.
SAMPLE_TEXTS = [
    "Hamburgefonts ABCDEFG abcdefg 1234",  # mixed pangram-like
    "abcdefghijklmnopqrstuvwxyz",          # full lowercase
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",          # full uppercase
]
RENDER_FONT_SIZE = 64
RENDER_PADDING = 16
WEIGHT_PREFERENCE = [400, 500, 300, 700, 600, 800, 900, 100, 200]
STYLE_PREFERENCE = ["normal", "italic"]
SUBSET_PREFERENCE = ["latin", "latin-ext"]
MAX_FONTS = int(os.environ.get("MAX_FONTS", "0"))  # 0 = no cap
CHECKPOINT_INTERVAL = 50
HTTP_TIMEOUT = 30.0

FONTSOURCE_LIST_URL = "https://api.fontsource.org/v1/fonts"
FONTSOURCE_CDN = "https://cdn.jsdelivr.net/fontsource/fonts"


# ---------- CLIP ------------------------------------------------------------ #

_clip_model = None
_clip_processor = None


def load_clip() -> None:
    global _clip_model, _clip_processor
    if _clip_model is not None:
        return
    log.info("Loading CLIP model openai/clip-vit-base-patch32 …")
    from transformers import CLIPModel, CLIPProcessor  # noqa: PLC0415

    _clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    _clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    _clip_model.eval()
    log.info("CLIP model loaded.")


def embed_image(img: Image.Image) -> np.ndarray:
    """Return a unit-normed CLIP embedding [512]."""
    import torch  # noqa: PLC0415

    inputs = _clip_processor(images=img, return_tensors="pt")
    with torch.no_grad():
        feats = _clip_model.get_image_features(**inputs)
    feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
    return feats.cpu().numpy()[0].astype(np.float32)


# ---------- Font rendering ------------------------------------------------- #


def render_sample(ttf_bytes: bytes, sample_text: str) -> Image.Image | None:
    """Render `sample_text` from in-memory TTF bytes. None on failure."""
    try:
        font = ImageFont.truetype(io.BytesIO(ttf_bytes), size=RENDER_FONT_SIZE)
    except Exception:
        return None
    dummy = Image.new("RGB", (1, 1))
    d = ImageDraw.Draw(dummy)
    try:
        bbox = d.textbbox((0, 0), sample_text, font=font)
    except Exception:
        return None
    w = bbox[2] - bbox[0] + RENDER_PADDING * 2
    h = bbox[3] - bbox[1] + RENDER_PADDING * 2
    if w <= 0 or h <= 0:
        return None
    img = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    try:
        draw.text(
            (RENDER_PADDING - bbox[0], RENDER_PADDING - bbox[1]),
            sample_text,
            font=font,
            fill=(0, 0, 0),
        )
    except Exception:
        return None
    return img


# ---------- Checkpoint ----------------------------------------------------- #


def load_checkpoint() -> dict[str, Any]:
    if CHECKPOINT_FILE.exists():
        try:
            with open(CHECKPOINT_FILE, encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict) and "done_ids" in d:
                return d
        except Exception:
            log.warning("Checkpoint file unreadable, starting over.")
    return {"done_ids": [], "vectors": [], "meta": []}


def save_checkpoint(state: dict[str, Any]) -> None:
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f)


# ---------- Fontsource API ------------------------------------------------- #


def fetch_font_list(client: httpx.Client) -> list[dict[str, Any]]:
    log.info("Fetching font catalog from %s …", FONTSOURCE_LIST_URL)
    r = client.get(FONTSOURCE_LIST_URL, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    fonts = r.json()
    log.info("Catalog returned %d fonts.", len(fonts))
    return fonts


def pick_download_url(font: dict[str, Any]) -> tuple[str, int, str, str] | None:
    """Choose (url, weight, style, subset) for the best representative variant."""
    weights = [int(w) for w in font.get("weights", []) if str(w).isdigit()]
    styles = font.get("styles", []) or ["normal"]
    subsets = font.get("subsets", []) or ["latin"]
    fid = font.get("id")
    if not fid or not weights:
        return None

    weight = next((w for w in WEIGHT_PREFERENCE if w in weights), weights[0])
    style = next((s for s in STYLE_PREFERENCE if s in styles), styles[0])
    subset = next((s for s in SUBSET_PREFERENCE if s in subsets), subsets[0])
    url = f"{FONTSOURCE_CDN}/{fid}@latest/{subset}-{weight}-{style}.ttf"
    return url, weight, style, subset


def style_name(weight: int, style: str) -> str:
    weight_name = {
        100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular",
        500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black",
    }.get(weight, str(weight))
    return f"{weight_name}{' Italic' if style == 'italic' else ''}"


# ---------- Main ----------------------------------------------------------- #


def main() -> None:
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    state = load_checkpoint()
    done_ids = set(state["done_ids"])
    vectors: list[list[float]] = state["vectors"]
    meta: list[dict] = state["meta"]
    log.info("Resuming from checkpoint: %d fonts already embedded.", len(done_ids))

    load_clip()

    headers = {"User-Agent": "QuickFix-FontIndex/1.0"}
    started = time.time()
    success = 0
    failed = 0

    with httpx.Client(headers=headers, follow_redirects=True) as client:
        fonts = fetch_font_list(client)
        if MAX_FONTS:
            fonts = fonts[:MAX_FONTS]
            log.info("MAX_FONTS=%d cap applied.", MAX_FONTS)

        total = len(fonts)
        for i, font in enumerate(fonts, 1):
            fid = font.get("id")
            if not fid or fid in done_ids:
                continue

            pick = pick_download_url(font)
            if not pick:
                failed += 1
                continue
            url, weight, style, subset = pick

            try:
                resp = client.get(url, timeout=HTTP_TIMEOUT)
                if resp.status_code != 200:
                    log.warning("[%d/%d] %s: HTTP %d for %s", i, total, fid, resp.status_code, url)
                    failed += 1
                    done_ids.add(fid)  # don't retry next run
                    continue
                ttf_bytes = resp.content
            except Exception as e:
                log.warning("[%d/%d] %s: download failed: %s", i, total, fid, e)
                failed += 1
                continue

            # Render + embed for each sample text variant. We store them as
            # separate entries; main.py groups by `id` and takes the max score
            # per font at query time, so the best-matching variant wins.
            font_vecs: list[list[float]] = []
            font_metas: list[dict] = []
            for variant_idx, sample_text in enumerate(SAMPLE_TEXTS):
                img = render_sample(ttf_bytes, sample_text)
                if img is None:
                    continue
                try:
                    vec = embed_image(img)
                except Exception as e:
                    log.warning("[%d/%d] %s variant=%d: embed failed: %s", i, total, fid, variant_idx, e)
                    continue
                font_vecs.append(vec.tolist())
                font_metas.append({
                    "id": fid,
                    "family": font.get("family", fid),
                    "style": style_name(weight, style),
                    "weight": weight,
                    "subset": subset,
                    "variant": variant_idx,
                    "source": "fontsource",
                    "category": font.get("category"),
                    "license": (font.get("license") if isinstance(font.get("license"), str)
                                else (font.get("license") or {}).get("type") or ""),
                    "downloadUrl": url,
                    "previewUrl": url,
                    "fontsourceUrl": f"https://fontsource.org/fonts/{fid}",
                })
            del ttf_bytes  # free memory promptly

            if not font_vecs:
                log.warning("[%d/%d] %s: all variants failed to render", i, total, fid)
                failed += 1
                done_ids.add(fid)
                continue

            vectors.extend(font_vecs)
            meta.extend(font_metas)
            done_ids.add(fid)
            success += 1

            if success % 25 == 0:
                rate = success / max(1, time.time() - started)
                eta_min = (total - i) / max(0.1, rate) / 60
                log.info("[%d/%d] %s — %d ok / %d failed — %.1f fonts/sec — ETA %.0f min",
                         i, total, fid, success, failed, rate, eta_min)

            if success % CHECKPOINT_INTERVAL == 0:
                save_checkpoint({
                    "done_ids": list(done_ids),
                    "vectors": vectors,
                    "meta": meta,
                })

    log.info("Embedding pass complete: %d ok, %d failed in %.0fs.",
             success, failed, time.time() - started)

    # Save final outputs
    save_checkpoint({"done_ids": list(done_ids), "vectors": vectors, "meta": meta})

    if vectors:
        arr = np.asarray(vectors, dtype=np.float32)
        np.savez_compressed(INDEX_NPZ, vectors=arr)
        with open(INDEX_JSON, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
        log.info("Wrote %s (%d×%d, %.1f MB) and %s (%d entries).",
                 INDEX_NPZ, arr.shape[0], arr.shape[1],
                 INDEX_NPZ.stat().st_size / 1024 / 1024,
                 INDEX_JSON, len(meta))
    else:
        log.error("No vectors built — index not written.")


if __name__ == "__main__":
    main()

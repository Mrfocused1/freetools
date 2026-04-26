#!/usr/bin/env python3
"""build_index.py — one-time script to build the font CLIP index.

Run this ONCE on the server after first deploy, inside the font-worker container:

    docker compose run --rm font-worker python build_index.py

Or from the host if you have Python + the same deps installed locally:

    python apps/font-worker/build_index.py

Output (written to /data by default, or $INDEX_DIR):
  font_index.npz  — numpy array of shape [N, 512] (CLIP embeddings, unit-normed)
  font_index.json — list of N metadata dicts

Runtime: ~2-4 hours for ~5 000 fonts on a 4-core CPU.
Memory:  ~2 GB peak (CLIP model + batch processing).

Design decisions
----------------
- Google Fonts source: git clone of https://github.com/google/fonts.git (~5 GB).
  We use a sparse/shallow clone to keep it manageable. Each family lives under
  ofl/, apache/, ufl/, etc. — we recurse all .ttf/.otf files.

- Fontsource source: git clone of https://github.com/fontsource/font-files.git
  (~8 GB). This repo mirrors both Google Fonts and Font Squirrel-licensed fonts
  in a normalized structure. We skip families already found in the Google Fonts
  clone to avoid duplicates.

  If the Fontsource clone fails (network/disk), we log a warning and continue
  with Google Fonts only.

- Checkpointing: we write a checkpoint JSON after every CHECKPOINT_INTERVAL
  fonts so an interrupted run can resume. Re-running the script skips already-
  embedded fonts (matched by absolute file path).

- CLIP rendering: we render a fixed sample string at 64 px using PIL/freetype,
  tight-crop, then embed with openai/clip-vit-base-patch32. We embed the
  *rendered* font image, NOT text — so the search is purely visual.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Configuration                                                                 #
# --------------------------------------------------------------------------- #

INDEX_DIR = Path(os.environ.get("INDEX_DIR", "/data"))
FONT_DIR = Path(os.environ.get("FONT_DIR", "/tmp/fonts"))
GOOGLE_FONTS_DIR = FONT_DIR / "google-fonts"
FONTSOURCE_DIR = FONT_DIR / "fontsource"

CHECKPOINT_FILE = INDEX_DIR / "build_checkpoint.json"
OUT_NPZ = INDEX_DIR / "font_index.npz"
OUT_JSON = INDEX_DIR / "font_index.json"

CHECKPOINT_INTERVAL = 100  # save every N fonts

SAMPLE_TEXT = "Hamburgefonts ABCDEFG abcdefg 1234"
RENDER_FONT_SIZE = 64  # px
RENDER_PADDING = 8     # px around text
CLIP_EMBED_DIM = 512

# Google Fonts license-dir → SPDX license identifier
GOOGLE_LICENSE_MAP = {
    "ofl": "SIL OFL-1.1",
    "apache": "Apache-2.0",
    "ufl": "Ubuntu Font Licence 1.0",
    "cc-by": "CC BY 4.0",
}

# --------------------------------------------------------------------------- #
# CLIP helpers                                                                  #
# --------------------------------------------------------------------------- #

_clip_model = None
_clip_processor = None


def load_clip() -> None:
    global _clip_model, _clip_processor
    if _clip_model is not None:
        return
    log.info("Loading CLIP model (first time = ~600 MB download) …")
    import torch
    from transformers import CLIPModel, CLIPProcessor

    _clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    _clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    _clip_model.eval()
    log.info("CLIP ready.")


def embed_image(img: Image.Image) -> np.ndarray:
    """Return a unit-normed CLIP embedding [512]."""
    import torch

    inputs = _clip_processor(images=img, return_tensors="pt")
    with torch.no_grad():
        feats = _clip_model.get_image_features(**inputs)
    vec = feats[0].cpu().numpy().astype(np.float32)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec /= norm
    return vec


# --------------------------------------------------------------------------- #
# Font rendering                                                                #
# --------------------------------------------------------------------------- #


def render_sample(font_path: Path) -> Image.Image | None:
    """Render SAMPLE_TEXT with the given font. Returns None on failure."""
    try:
        font = ImageFont.truetype(str(font_path), size=RENDER_FONT_SIZE)
    except Exception:
        return None

    # Measure text size via a temporary draw call
    dummy = Image.new("RGB", (1, 1))
    d = ImageDraw.Draw(dummy)
    try:
        bbox = d.textbbox((0, 0), SAMPLE_TEXT, font=font)
    except Exception:
        return None

    w = bbox[2] - bbox[0] + RENDER_PADDING * 2
    h = bbox[3] - bbox[1] + RENDER_PADDING * 2
    if w <= 0 or h <= 0:
        return None

    img = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    try:
        draw.text((RENDER_PADDING - bbox[0], RENDER_PADDING - bbox[1]), SAMPLE_TEXT, font=font, fill=(0, 0, 0))
    except Exception:
        return None

    return img


# --------------------------------------------------------------------------- #
# Checkpoint helpers                                                            #
# --------------------------------------------------------------------------- #


def load_checkpoint() -> dict[str, Any]:
    if CHECKPOINT_FILE.exists():
        with open(CHECKPOINT_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {"done_paths": [], "vectors": [], "meta": []}


def save_checkpoint(done_paths: list[str], vectors: list[list[float]], meta: list[dict]) -> None:
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    tmp = {
        "done_paths": done_paths,
        # We store vectors as lists for JSON serialization; final output uses npz.
        "vectors": [v.tolist() if isinstance(v, np.ndarray) else v for v in vectors],
        "meta": meta,
    }
    with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
        json.dump(tmp, f)
    log.info("Checkpoint saved (%d fonts).", len(done_paths))


# --------------------------------------------------------------------------- #
# Font discovery                                                                #
# --------------------------------------------------------------------------- #


def _git_clone(url: str, dest: Path, depth: int = 1) -> bool:
    """Shallow-clone a git repo. Returns True on success."""
    if dest.exists() and (dest / ".git").exists():
        log.info("Repo already cloned at %s — skipping clone.", dest)
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    log.info("Cloning %s → %s (depth %d) …", url, dest, depth)
    result = subprocess.run(
        ["git", "clone", "--depth", str(depth), "--filter=blob:none", url, str(dest)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        log.error("git clone failed:\n%s", result.stderr[:2000])
        return False
    log.info("Clone complete: %s", dest)
    return True


def discover_google_fonts() -> list[dict[str, Any]]:
    """Return a list of font-file records from the Google Fonts git repo."""
    ok = _git_clone(
        "https://github.com/google/fonts.git",
        GOOGLE_FONTS_DIR,
        depth=1,
    )
    if not ok:
        log.error("Could not clone Google Fonts — skipping.")
        return []

    records = []
    # Google Fonts repo layout: <license-dir>/<family>/<variant>.ttf
    for font_file in GOOGLE_FONTS_DIR.rglob("*.ttf"):
        parts = font_file.relative_to(GOOGLE_FONTS_DIR).parts
        if len(parts) < 3:
            continue
        license_dir = parts[0]
        family_dir = parts[1]
        filename = font_file.stem  # e.g. "Roboto-Regular"

        # Parse style from filename: "FamilyName-Style" or just "FamilyName"
        if "-" in filename:
            style = filename.split("-", 1)[1]
        else:
            style = "Regular"

        # Family name: convert directory name (kebab/title) → title case
        family = family_dir.replace("-", " ").replace("_", " ").title()

        license_spdx = GOOGLE_LICENSE_MAP.get(license_dir.lower(), "SIL OFL-1.1")

        records.append(
            {
                "path": str(font_file),
                "family": family,
                "style": style,
                "source": "google",
                "license": license_spdx,
                "previewUrl": (
                    f"https://fonts.gstatic.com/s/{family_dir.lower()}/v1/"
                    f"{font_file.name}"
                ),
                "downloadUrl": (
                    f"https://fonts.google.com/specimen/{family.replace(' ', '+')}"
                ),
            }
        )

    log.info("Discovered %d Google Font variants.", len(records))
    return records


def discover_fontsource_fonts(already_families: set[str]) -> list[dict[str, Any]]:
    """Return font-file records from the Fontsource font-files repo.

    We skip families that already exist in the Google Fonts set to avoid
    duplicates (Fontsource mirrors many Google Fonts).
    """
    ok = _git_clone(
        "https://github.com/fontsource/font-files.git",
        FONTSOURCE_DIR,
        depth=1,
    )
    if not ok:
        log.warning("Could not clone Fontsource — falling back to Google Fonts only.")
        return []

    records = []
    # Fontsource layout: fonts/<source>/<family>/<variant>.ttf
    # sources include 'google', 'other', etc.
    for font_file in FONTSOURCE_DIR.rglob("*.ttf"):
        parts = font_file.relative_to(FONTSOURCE_DIR).parts
        if len(parts) < 3:
            continue

        # e.g. parts = ("fonts", "other", "open-sans", "open-sans-regular.ttf")
        source_bucket = parts[1] if len(parts) > 3 else "other"

        # Skip Google Fonts we already have from the Google repo
        if source_bucket == "google":
            continue

        family_dir = parts[-2]
        filename = font_file.stem

        if "-" in filename:
            style = filename.split("-", 1)[1].replace("-", " ").title()
        else:
            style = "Regular"

        family = family_dir.replace("-", " ").replace("_", " ").title()

        # Skip if we already have this family from Google Fonts
        if family.lower() in already_families:
            continue

        records.append(
            {
                "path": str(font_file),
                "family": family,
                "style": style,
                "source": "fontsource",
                "license": "SIL OFL-1.1",  # Fontsource only hosts OFL fonts
                "previewUrl": "",
                "downloadUrl": (
                    f"https://fontsource.org/fonts/{family_dir.lower()}"
                ),
            }
        )

    log.info("Discovered %d Fontsource variants (non-Google).", len(records))
    return records


# --------------------------------------------------------------------------- #
# Main                                                                          #
# --------------------------------------------------------------------------- #


def main() -> None:
    t0 = time.time()
    INDEX_DIR.mkdir(parents=True, exist_ok=True)

    load_clip()

    # Load checkpoint (allows resuming interrupted runs)
    ckpt = load_checkpoint()
    done_paths: set[str] = set(ckpt["done_paths"])
    vectors: list[np.ndarray] = [
        np.array(v, dtype=np.float32) for v in ckpt.get("vectors", [])
    ]
    meta: list[dict] = ckpt.get("meta", [])
    log.info("Resuming from checkpoint: %d fonts already embedded.", len(done_paths))

    # Discover all fonts
    google_records = discover_google_fonts()
    google_families = {r["family"].lower() for r in google_records}
    fontsource_records = discover_fontsource_fonts(google_families)
    all_records = google_records + fontsource_records

    # Filter out already-processed paths
    to_process = [r for r in all_records if r["path"] not in done_paths]
    log.info(
        "Total: %d fonts discovered, %d need embedding.",
        len(all_records),
        len(to_process),
    )

    skipped = 0
    processed = 0
    since_ckpt = 0

    for i, record in enumerate(to_process):
        font_path = Path(record["path"])

        img = render_sample(font_path)
        if img is None:
            skipped += 1
            if (i + 1) % 500 == 0:
                log.info("Progress: %d/%d (skipped %d so far)", i + 1, len(to_process), skipped)
            continue

        try:
            vec = embed_image(img)
        except Exception as exc:
            log.warning("Embed failed for %s: %s", font_path.name, exc)
            skipped += 1
            continue

        vectors.append(vec)
        meta.append({k: v for k, v in record.items() if k != "path"})
        done_paths.add(record["path"])
        processed += 1
        since_ckpt += 1

        if since_ckpt >= CHECKPOINT_INTERVAL:
            save_checkpoint(list(done_paths), vectors, meta)
            since_ckpt = 0
            elapsed = time.time() - t0
            rate = processed / elapsed if elapsed > 0 else 0
            remaining = (len(to_process) - i - 1) / max(rate, 1e-9)
            log.info(
                "Progress: %d/%d embedded | %.1f fonts/s | ~%.0f min remaining",
                processed,
                len(to_process),
                rate,
                remaining / 60,
            )

    # Final save
    if not vectors:
        log.error("No fonts were successfully embedded. Check font paths and PIL setup.")
        sys.exit(1)

    arr = np.stack(vectors, axis=0).astype(np.float32)
    np.savez_compressed(str(OUT_NPZ), vectors=arr)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)

    elapsed = time.time() - t0
    log.info(
        "Done. %d fonts indexed, %d skipped. "
        "Output: %s (%.1f MB), %s (%.1f MB). Elapsed: %.0f s.",
        len(meta),
        skipped,
        OUT_NPZ,
        OUT_NPZ.stat().st_size / 1e6,
        OUT_JSON,
        OUT_JSON.stat().st_size / 1e6,
        elapsed,
    )

    # Remove checkpoint now that we have the final output
    if CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()
        log.info("Checkpoint file removed.")


if __name__ == "__main__":
    main()

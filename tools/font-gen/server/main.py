"""font-gen worker — Phase 2: generate a custom TTF from a user's image.

POST /generate
  Authorization: Bearer <FONT_GEN_TOKEN>
  Content-Type: application/json
  Body: {
    "imageDataUrl": "data:image/png;base64,...",
    "fontFamily":   "MyCustomFont",
    "targetCharset": "ABCDEFGHIJKLMNOPQRSTUVWXYZ..."
  }
  →  {"ttfUrl": "https://..."} | {"ttfBase64": "<base64>"}

GET /health
  Authorization: Bearer <FONT_GEN_TOKEN>
  →  {"ok": true, "mxfont": true|false, "paddleocr": "ready"|"not loaded"}

Environment variables:
  FONT_GEN_TOKEN  (required) — shared secret with the Next.js proxy
  SUPABASE_URL    (optional) — Supabase project URL for TTF upload
  SUPABASE_KEY    (optional) — Supabase service role key
"""

from __future__ import annotations

import base64
import logging
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import pipeline as pipe

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

FONT_GEN_TOKEN: str = os.environ.get("FONT_GEN_TOKEN", "")

DEFAULT_CHARSET = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    "0123456789"
    "!?.,;:'\"-@#$%&*()"
)

MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB generous limit for data URLs


# --------------------------------------------------------------------------- #
# Request / response models                                                     #
# --------------------------------------------------------------------------- #


class GenerateRequest(BaseModel):
    imageDataUrl: str
    fontFamily: str = "CustomFont"
    targetCharset: str = DEFAULT_CHARSET


# --------------------------------------------------------------------------- #
# Auth                                                                          #
# --------------------------------------------------------------------------- #


def _check_auth(authorization: str | None) -> None:
    if not FONT_GEN_TOKEN:
        raise HTTPException(status_code=503, detail="FONT_GEN_TOKEN not configured on worker")
    if not authorization or authorization != f"Bearer {FONT_GEN_TOKEN}":
        raise HTTPException(status_code=401, detail="invalid token")


# --------------------------------------------------------------------------- #
# Application                                                                   #
# --------------------------------------------------------------------------- #

app = FastAPI(title="font-gen-worker", version="2.0.0")


@app.on_event("startup")
async def startup() -> None:
    """Pre-load heavy models so first request doesn't time out."""
    log.info("Startup: pre-loading PaddleOCR...")
    try:
        pipe._load_paddle()
    except Exception as exc:
        log.warning("PaddleOCR failed to load at startup: %s", exc)

    log.info("Startup: pre-loading MX-Font...")
    try:
        pipe._load_mxfont()
    except Exception as exc:
        log.warning("MX-Font failed to load at startup: %s", exc)

    log.info("Startup complete.")


@app.get("/health")
async def health(authorization: str | None = Header(None)) -> dict[str, Any]:
    _check_auth(authorization)
    mxfont_ready = pipe._mxfont_model is not None
    paddle_ready = pipe._paddle_ocr is not None
    return {
        "ok": True,
        "mxfont": mxfont_ready,
        "paddleocr": "ready" if paddle_ready else "not loaded",
    }


@app.post("/generate")
async def generate(
    body: GenerateRequest,
    authorization: str | None = Header(None),
) -> JSONResponse:
    _check_auth(authorization)

    # Decode data URL → bytes.
    data_url = body.imageDataUrl
    if not data_url.startswith("data:"):
        raise HTTPException(status_code=400, detail="imageDataUrl must be a data: URI")

    try:
        header, b64 = data_url.split(",", 1)
        image_bytes = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed imageDataUrl (base64 decode failed)")

    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"Image too large (max {MAX_IMAGE_BYTES // 1024 // 1024} MB)")

    font_family = (body.fontFamily or "CustomFont").strip()[:64]
    target_charset = body.targetCharset or DEFAULT_CHARSET

    try:
        result = pipe.run_pipeline(image_bytes, font_family, target_charset)
    except Exception as exc:
        log.exception("Pipeline error")
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {exc}") from exc

    return JSONResponse(result)

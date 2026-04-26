"""font-gen pipeline — segment → OCR → vectorize → fill missing → assemble TTF.

Design notes
------------
- **Segmentation**: binarize with Otsu, then cv2.connectedComponentsWithStats.
  More reliable than SAM2 for clean text-on-background screenshots (v1 scope).
- **OCR**: PaddleOCR per crop. Each segmented glyph is matched to a character.
  Falls back to skipping the glyph if OCR confidence < 0.5.
- **Vectorisation**: pypotrace (Python bindings for Potrace). Works on a binary
  single-channel image. Returns BezierPath objects which we convert to fonttools
  contour format.
- **Missing character synthesis**: MX-Font (CLOVA AI, MIT). Requires at least
  ~4 known glyphs as style references; fewer → lower quality. Synthesised images
  are vectorised the same way as extracted glyphs.
- **TTF assembly**: fonttools with em-square = 1000 (compact, standard). We
  build a minimal but installable TTF: cmap (Unicode), glyf, loca, hmtx, hhea,
  OS/2, post, name, head, maxp.
- **Supabase upload**: optional. If SUPABASE_URL + SUPABASE_KEY are not set,
  the TTF bytes are returned as base64 in the JSON response instead.

Known v0 gaps
-------------
- Kerning is not computed (all glyphs use advance width = bbox width + 20 u).
- Italic / bold variants not supported.
- Ligatures not supported.
- MX-Font synthesis quality drops for very large or very small input glyph sets.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# MX-Font lazy loader                                                           #
# --------------------------------------------------------------------------- #

_MXFONT_DIR = Path("/workspace/mxfont")
_MXFONT_CKPT = Path("/workspace/mxfont/ckpts/mxfont_ckpt.pth")

_mxfont_model: Any = None  # loaded on first call to generate_missing_glyphs


def _load_mxfont() -> Any:
    """Load MX-Font model (once). Returns None if checkpoint missing."""
    global _mxfont_model
    if _mxfont_model is not None:
        return _mxfont_model
    if not _MXFONT_CKPT.exists():
        log.warning("MX-Font checkpoint not found at %s; skipping synthesis", _MXFONT_CKPT)
        return None
    if str(_MXFONT_DIR) not in sys.path:
        sys.path.insert(0, str(_MXFONT_DIR))
    try:
        import torch  # noqa: PLC0415
        from model import Generator  # noqa: PLC0415  (from mxfont repo)
        from options import get_options  # noqa: PLC0415

        # MX-Font generator; options file lives in the mxfont dir.
        opts_path = _MXFONT_DIR / "cfgs" / "eval.yaml"
        opts = get_options(str(opts_path) if opts_path.exists() else None)
        g = Generator(opts)
        ckpt = torch.load(str(_MXFONT_CKPT), map_location="cpu")
        state = ckpt.get("generator", ckpt.get("state_dict", ckpt))
        g.load_state_dict(state, strict=False)
        g.eval()
        if torch.cuda.is_available():
            g = g.cuda()
        _mxfont_model = g
        log.info("MX-Font model loaded (CUDA: %s)", torch.cuda.is_available())
        return _mxfont_model
    except Exception as exc:
        log.warning("MX-Font load failed (%s); synthesis unavailable", exc)
        return None


# --------------------------------------------------------------------------- #
# PaddleOCR lazy loader                                                         #
# --------------------------------------------------------------------------- #

_paddle_ocr: Any = None


def _load_paddle() -> Any:
    """Load PaddleOCR (once)."""
    global _paddle_ocr
    if _paddle_ocr is not None:
        return _paddle_ocr
    from paddleocr import PaddleOCR  # noqa: PLC0415

    # lang='en' for now; rec_algorithm=SVTR_LCNet is compact + fast.
    _paddle_ocr = PaddleOCR(use_angle_cls=False, lang="en", show_log=False)
    log.info("PaddleOCR loaded.")
    return _paddle_ocr


# --------------------------------------------------------------------------- #
# Data types                                                                    #
# --------------------------------------------------------------------------- #

EM = 1000  # em-square units
BASELINE_RATIO = 0.8  # fraction of EM below the top = ascender height
DESCENDER = -200  # fixed descender depth in units


@dataclass
class GlyphContour:
    """A single contour (filled or counter) within a glyph."""
    points: list[tuple[float, float, float, float, float, float]]
    # Each point: (x0, y0, x1, y1, x2, y2) — two off-curve + one on-curve for
    # quadratic splines (fonttools TrueType), or 3 on-curve for outlines.
    is_open: bool = False


@dataclass
class GlyphData:
    char: str
    width: int   # advance width in EM units
    contours: list[GlyphContour] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Step 1 — Segmentation                                                         #
# --------------------------------------------------------------------------- #

def segment_glyphs(image_bytes: bytes) -> list[tuple[str | None, np.ndarray]]:
    """Return a list of (char_or_None, glyph_image_BGR) sorted left-to-right.

    char_or_None is populated in Step 2 (OCR). We return None here and fill
    in later. This separation makes the function independently testable.
    """
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image bytes with OpenCV")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Otsu binarise — produces 0 (text) / 255 (background) on typical images.
    # Works best with white or light background; may need inversion.
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Invert if majority of pixels are black (dark background).
    if np.mean(binary == 0) > 0.5:
        binary = cv2.bitwise_not(binary)

    # Invert so text = white (255) on black (0) for connectedComponents.
    text_mask = cv2.bitwise_not(binary)

    # Dilate slightly so touching parts of a single glyph merge.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    dilated = cv2.dilate(text_mask, kernel, iterations=1)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
        dilated, connectivity=8, ltype=cv2.CV_32S
    )

    h_img, w_img = img.shape[:2]
    min_area = max(20, int(h_img * w_img * 0.0001))  # ignore specks

    crops: list[tuple[int, np.ndarray]] = []  # (x, crop_bgr)
    for label in range(1, num_labels):  # skip label 0 (background)
        x, y, w, h, area = stats[label]
        if area < min_area:
            continue
        # Pad the crop by 4 px on all sides (clamped to image edges).
        pad = 4
        x0 = max(0, x - pad)
        y0 = max(0, y - pad)
        x1 = min(w_img, x + w + pad)
        y1 = min(h_img, y + h + pad)
        crop = img[y0:y1, x0:x1]
        crops.append((x, crop))

    # Sort left-to-right by x coordinate.
    crops.sort(key=lambda t: t[0])
    return [(None, c) for _, c in crops]


# --------------------------------------------------------------------------- #
# Step 2 — OCR labelling                                                        #
# --------------------------------------------------------------------------- #

MIN_OCR_CONFIDENCE = 0.5


def label_glyphs(
    crops: list[tuple[str | None, np.ndarray]],
) -> list[tuple[str, np.ndarray]]:
    """Run PaddleOCR on each crop and map to a character.

    We call OCR on each individual glyph crop. PaddleOCR returns text+confidence
    per recognised region. We take the first character of the top-confidence
    detection. Crops with confidence < MIN_OCR_CONFIDENCE are discarded.
    """
    ocr = _load_paddle()
    labelled: list[tuple[str, np.ndarray]] = []

    for _char, crop in crops:
        # PaddleOCR expects a BGR numpy array or a file path.
        result = ocr.ocr(crop, cls=False)
        if not result or not result[0]:
            continue
        # result[0] = list of [bbox, (text, confidence)]
        best_text = ""
        best_conf = 0.0
        for line in result[0]:
            text, conf = line[1]
            if conf > best_conf:
                best_conf = conf
                best_text = text

        if best_conf < MIN_OCR_CONFIDENCE or not best_text:
            continue

        # Use only the first character of the recognised text.
        char = best_text[0]
        labelled.append((char, crop))

    # De-duplicate: if the same character appears multiple times, keep the crop
    # with the largest area (most representative glyph image).
    deduped: dict[str, np.ndarray] = {}
    for char, crop in labelled:
        existing = deduped.get(char)
        if existing is None or crop.size > existing.size:
            deduped[char] = crop

    return list(deduped.items())


# --------------------------------------------------------------------------- #
# Step 3 — Vectorisation (Potrace)                                              #
# --------------------------------------------------------------------------- #


def _crop_to_potrace_paths(crop_bgr: np.ndarray) -> list[Any]:
    """Convert a BGR glyph crop to a list of Potrace BezierPath objects."""
    import potrace  # noqa: PLC0415  (pypotrace)

    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Potrace expects: 1 = ink (text), 0 = background.
    # After binarise, 0 = text, 255 = background → invert.
    ink = (binary == 0).astype(np.uint8)

    bmp = potrace.Bitmap(ink)
    path = bmp.trace(
        turdsize=2,       # ignore specks with area ≤ 2 px²
        turnpolicy=potrace.TURNPOLICY_MINORITY,
        alphamax=1.0,
        opticurve=True,
        opttolerance=0.2,
    )
    return list(path)  # list of potrace.Path objects (each a closed curve)


def _potrace_paths_to_contour_points(
    paths: list[Any],
    crop_h: int,
    crop_w: int,
    em: int,
) -> list[list[tuple[int, int]]]:
    """Convert Potrace BezierPath segments into EM-scaled on-curve point lists.

    TrueType uses quadratic Bézier curves (unlike PostScript cubic). We
    approximate each Potrace cubic segment with line segments (sufficient for
    v0). The y-axis in TrueType is bottom-up; Potrace is top-down, so we flip.

    Returns a list of contours, each a list of (x, y) integer EM-unit points.
    """
    contours: list[list[tuple[int, int]]] = []

    scale_x = em / max(crop_w, 1)
    # Map the full crop height to (BASELINE_RATIO * em) so the glyph sits above
    # the baseline. Descenders are handled by using a negative y offset.
    ascender = int(BASELINE_RATIO * em)
    scale_y = ascender / max(crop_h, 1)

    for bezier_path in paths:
        points_em: list[tuple[int, int]] = []
        for segment in bezier_path:
            # Each segment has an end_point and a list of (c1, c2, end) cubic controls.
            # We decompose into line segments by sampling at the end points only
            # (v0 approximation).
            ep = segment.end_point
            x_em = int(ep.x * scale_x)
            # Flip y: Potrace origin is top-left; TTF is bottom-left.
            y_em = ascender - int(ep.y * scale_y)
            points_em.append((x_em, y_em))

        if len(points_em) >= 3:
            contours.append(points_em)

    return contours


def vectorize_glyphs(
    labelled: list[tuple[str, np.ndarray]],
) -> dict[str, list[list[tuple[int, int]]]]:
    """Return {char: [contour, ...]} where each contour is a list of (x,y) EM points."""
    result: dict[str, list[list[tuple[int, int]]]] = {}
    for char, crop in labelled:
        try:
            paths = _crop_to_potrace_paths(crop)
            h, w = crop.shape[:2]
            contours = _potrace_paths_to_contour_points(paths, h, w, EM)
            if contours:
                result[char] = contours
        except Exception as exc:
            log.warning("Vectorise failed for %r: %s", char, exc)
    return result


# --------------------------------------------------------------------------- #
# Step 4 — Missing character synthesis (MX-Font)                               #
# --------------------------------------------------------------------------- #

_GLYPH_RENDER_SIZE = 128  # pixels; MX-Font works in 128×128


def _contours_to_image(
    contours: list[list[tuple[int, int]]],
    size: int = _GLYPH_RENDER_SIZE,
) -> np.ndarray:
    """Rasterise EM-unit contours back to a grayscale image for MX-Font input."""
    canvas = np.ones((size, size), dtype=np.uint8) * 255
    ascender = int(BASELINE_RATIO * EM)
    for contour in contours:
        pts = []
        for x_em, y_em in contour:
            px = int(x_em * size / EM)
            # Flip y back to image coords.
            py = int((ascender - y_em) * size / ascender)
            pts.append([px, py])
        if len(pts) >= 3:
            pts_arr = np.array(pts, dtype=np.int32)
            cv2.fillPoly(canvas, [pts_arr], 0)
    return canvas


def generate_missing_glyphs(
    known_chars: dict[str, list[list[tuple[int, int]]]],
    target_charset: str,
) -> dict[str, list[list[tuple[int, int]]]]:
    """Use MX-Font to synthesise glyphs for characters not in known_chars.

    Falls back gracefully:
    - If MX-Font is not available → returns empty dict (missing chars are filled
      with a blank glyph in step 5).
    - If fewer than 4 known glyphs → MX-Font quality degrades; we still try.
    """
    missing = [c for c in target_charset if c not in known_chars and c.strip()]
    if not missing:
        return {}

    gen = _load_mxfont()
    if gen is None:
        log.info("MX-Font unavailable; %d chars will be blank placeholders", len(missing))
        return {}

    log.info("Synthesising %d missing glyphs with MX-Font...", len(missing))

    try:
        import torch  # noqa: PLC0415
        import torchvision.transforms as T  # noqa: PLC0415

        transform = T.Compose([
            T.Resize((_GLYPH_RENDER_SIZE, _GLYPH_RENDER_SIZE)),
            T.ToTensor(),
            T.Normalize([0.5], [0.5]),
        ])

        # Build reference style images from known glyphs.
        ref_images: list[torch.Tensor] = []
        for contours in list(known_chars.values())[:8]:  # cap at 8 style refs
            gray = _contours_to_image(contours)
            pil = Image.fromarray(gray, mode="L").convert("RGB")
            ref_images.append(transform(pil))

        if not ref_images:
            return {}

        style_tensor = torch.stack(ref_images).unsqueeze(0)  # [1, N, 3, H, W]
        if next(gen.parameters()).is_cuda:
            style_tensor = style_tensor.cuda()

        synthesised: dict[str, list[list[tuple[int, int]]]] = {}

        for char in missing:
            # MX-Font takes a character index (Unicode code point) as content.
            char_idx = torch.tensor([[ord(char)]], dtype=torch.long)
            if next(gen.parameters()).is_cuda:
                char_idx = char_idx.cuda()

            with torch.no_grad():
                out = gen(style_tensor, char_idx)  # [1, 1, H, W] or [1, 3, H, W]

            out_np = out[0].cpu().squeeze().numpy()
            # Denormalise from [-1, 1] → [0, 255].
            out_np = ((out_np + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
            if out_np.ndim == 3:
                out_np = cv2.cvtColor(out_np.transpose(1, 2, 0), cv2.COLOR_RGB2GRAY)

            # Convert synthesised raster → contours via Potrace.
            crop_bgr = cv2.cvtColor(out_np, cv2.COLOR_GRAY2BGR)
            try:
                paths = _crop_to_potrace_paths(crop_bgr)
                h, w = out_np.shape[:2]
                contours = _potrace_paths_to_contour_points(paths, h, w, EM)
                if contours:
                    synthesised[char] = contours
            except Exception as exc:
                log.warning("Potrace failed on synth glyph %r: %s", char, exc)

        return synthesised

    except Exception as exc:
        log.warning("MX-Font synthesis failed: %s", exc)
        return {}


# --------------------------------------------------------------------------- #
# Step 5 — Compose TTF with fonttools                                           #
# --------------------------------------------------------------------------- #


def _blank_glyph_contours(advance_width: int) -> list[list[tuple[int, int]]]:
    """Return contours for a blank (space-like) placeholder glyph."""
    _ = advance_width
    return []  # no ink = blank placeholder


def compose_ttf(
    all_glyphs: dict[str, list[list[tuple[int, int]]]],
    font_family: str,
) -> bytes:
    """Build a minimal TTF binary from glyph contours.

    Returns the raw TTF bytes.
    """
    from fonttools.fontBuilder import FontBuilder  # noqa: PLC0415
    from fonttools.pens.t2Pen import T2Pen  # noqa: PLC0415  (Type-2 / CFF)
    from fonttools.pens.ttGlyphPen import TTGlyphQuadPen  # noqa: PLC0415

    fb = FontBuilder(EM, isTTF=True)

    # --- Glyph list (always include .notdef first) --------------------------
    glyph_names = [".notdef"]
    char_to_glyph: dict[str, str] = {}
    for char in sorted(all_glyphs.keys()):
        safe_name = f"uni{ord(char):04X}"
        glyph_names.append(safe_name)
        char_to_glyph[char] = safe_name

    fb.setupGlyphOrder(glyph_names)

    # --- cmap (Unicode → glyph name) ---------------------------------------
    cmap: dict[int, str] = {}
    for char, gname in char_to_glyph.items():
        cmap[ord(char)] = gname
    fb.setupCharacterMap(cmap)

    # --- Draw glyphs --------------------------------------------------------
    glyphs_metrics: dict[str, tuple[int, int, int, int]] = {}
    glyph_pen_data: dict[str, Any] = {}

    default_advance = int(EM * 0.6)

    def _draw_char(gname: str, contours: list[list[tuple[int, int]]]) -> None:
        pen = TTGlyphQuadPen(None, None)
        if contours:
            x_min = min(p[0] for c in contours for p in c)
            x_max = max(p[0] for c in contours for p in c)
            y_min = min(p[1] for c in contours for p in c)
            y_max = max(p[1] for c in contours for p in c)
            advance = max(default_advance, x_max + 50)
            for contour in contours:
                if len(contour) < 3:
                    continue
                pen.beginPath()
                for x, y in contour:
                    pen.endPath()
                    break
                # Use moveTo + lineTo for v0 (no cubic/quadratic curves from Potrace).
                # This keeps the outline simple but correct.
                pen.beginPath()
                pen.qCurveSet(
                    [(x, y) for x, y in contour],
                )
        else:
            advance = default_advance
            x_min = x_max = y_min = y_max = 0

        glyphs_metrics[gname] = (advance, x_min, y_min, x_max, y_max)
        glyph_pen_data[gname] = contours

    _draw_char(".notdef", [])
    for char, gname in char_to_glyph.items():
        _draw_char(gname, all_glyphs.get(char, []))

    # Build actual glyph objects using a simpler direct approach.
    from fonttools import ttLib  # noqa: PLC0415
    from fonttools.ttLib.tables import _g_l_y_f as glyf_module  # noqa: PLC0415, N812

    glyf_table = ttLib.newTable("glyf")
    glyf_table.glyphs = {}

    metrics: dict[str, tuple[int, int]] = {}  # gname → (advance, lsb)

    for gname, contours in glyph_pen_data.items():
        adv, x_min, y_min, x_max, y_max = glyphs_metrics[gname]
        metrics[gname] = (adv, x_min)

        if not contours:
            # Empty glyph (blank / .notdef).
            g = glyf_module.Glyph()
            g.numberOfContours = 0
            g.coordinates = glyf_module.GlyphCoordinates([])
            g.flags = np.array([], dtype=np.uint8)
            g.endPtsOfContours = []
            g.components = []
            glyf_table.glyphs[gname] = g
            continue

        all_pts: list[tuple[int, int]] = []
        end_pts: list[int] = []
        flags_list: list[int] = []

        for contour in contours:
            if len(contour) < 3:
                continue
            for pt in contour:
                all_pts.append(pt)
                flags_list.append(1)  # on-curve
            end_pts.append(len(all_pts) - 1)

        if not all_pts:
            g = glyf_module.Glyph()
            g.numberOfContours = 0
            g.coordinates = glyf_module.GlyphCoordinates([])
            g.flags = np.array([], dtype=np.uint8)
            g.endPtsOfContours = []
            g.components = []
            glyf_table.glyphs[gname] = g
            continue

        g = glyf_module.Glyph()
        g.numberOfContours = len(end_pts)
        g.coordinates = glyf_module.GlyphCoordinates(all_pts)
        g.flags = np.array(flags_list, dtype=np.uint8)
        g.endPtsOfContours = end_pts
        g.components = []
        glyf_table.glyphs[gname] = g

    # --- Build full font using FontBuilder ----------------------------------
    # Re-use fb but set up all tables directly.
    fb.setupGlyphOrder(glyph_names)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyf_table.glyphs)
    fb.setupHorizontalMetrics(metrics)

    ascender = int(BASELINE_RATIO * EM)
    descender = DESCENDER
    line_gap = 0
    fb.setupHorizontalHeader(ascent=ascender, descent=descender)
    fb.setupNameTable(
        {
            "familyName": font_family,
            "styleName": "Regular",
        }
    )
    fb.setupOs2(
        sTypoAscender=ascender,
        sTypoDescender=descender,
        sTypoLineGap=line_gap,
        usWinAscent=ascender,
        usWinDescent=abs(descender),
        fsType=0x0000,
        achVendID="QFPX",
    )
    fb.setupPost()
    fb.setupHead(unitsPerEm=EM)

    buf = io.BytesIO()
    fb.font.save(buf)
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# Step 6 — Supabase upload (optional)                                           #
# --------------------------------------------------------------------------- #


def upload_to_supabase(ttf_bytes: bytes, font_family: str) -> str | None:
    """Upload TTF to Supabase 'images' bucket. Returns signed URL or None."""
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        return None
    try:
        from supabase import create_client  # noqa: PLC0415

        client = create_client(url, key)
        safe_name = font_family.replace(" ", "_").replace("/", "_")
        import time  # noqa: PLC0415

        path = f"font-gen/{safe_name}_{int(time.time())}.ttf"
        client.storage.from_("images").upload(
            path,
            ttf_bytes,
            {"content-type": "font/ttf", "upsert": "false"},
        )
        signed = client.storage.from_("images").create_signed_url(path, 3600)
        return signed.get("signedURL") or signed.get("signedUrl")
    except Exception as exc:
        log.warning("Supabase upload failed: %s", exc)
        return None


# --------------------------------------------------------------------------- #
# Public entry point                                                            #
# --------------------------------------------------------------------------- #


def run_pipeline(
    image_bytes: bytes,
    font_family: str,
    target_charset: str,
) -> dict[str, str]:
    """Full pipeline. Returns {'ttfUrl': ...} or {'ttfBase64': ...}."""
    log.info("Pipeline start: family=%r charset_len=%d", font_family, len(target_charset))

    # Step 1 — segment
    crops = segment_glyphs(image_bytes)
    log.info("Segmented %d glyph candidates", len(crops))

    # Step 2 — OCR label
    labelled = label_glyphs(crops)
    log.info("OCR labelled %d glyphs: %s", len(labelled), [c for c, _ in labelled])

    # Step 3 — vectorise
    known_vectors = vectorize_glyphs(labelled)
    log.info("Vectorised %d glyphs", len(known_vectors))

    # Step 4 — synthesise missing
    synthesised = generate_missing_glyphs(known_vectors, target_charset)
    log.info("Synthesised %d missing glyphs", len(synthesised))

    all_glyphs = {**known_vectors, **synthesised}
    # Blank placeholders for any chars still missing.
    for char in target_charset:
        if char.strip() and char not in all_glyphs:
            all_glyphs[char] = []

    log.info("Total glyphs in font: %d", len(all_glyphs))

    # Step 5 — compose TTF
    ttf_bytes = compose_ttf(all_glyphs, font_family)
    log.info("TTF assembled: %d bytes", len(ttf_bytes))

    # Step 6 — upload or return base64
    signed_url = upload_to_supabase(ttf_bytes, font_family)
    if signed_url:
        return {"ttfUrl": signed_url}
    return {"ttfBase64": base64.b64encode(ttf_bytes).decode()}

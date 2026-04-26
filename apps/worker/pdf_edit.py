"""PDF text editing — parse + apply.

Runs entirely on CPU using PyMuPDF (fitz).

parse_pdf(pdf_bytes) -> ParseResult:
    Extracts every text span on every page, returning a JSON-serializable
    structure with stable IDs the frontend can use to address edits, plus
    a rendered PNG per page for the editor's visual layer.

apply_edits(pdf_bytes, edits) -> bytes:
    For each {pageNumber, blockId, newText} edit, redacts the original
    span (covers it with a white rectangle matching the page background)
    and re-inserts the new text in the same bbox using the closest
    matching font.

Born-digital PDFs are required — scanned PDFs (image-only pages) will
produce empty `blocks` arrays and should be routed to OCR instead.
"""
from __future__ import annotations

import base64
import io
from dataclasses import dataclass, field
from typing import Any

import fitz  # PyMuPDF


RENDER_DPI = 144  # 2× of standard 72 DPI — good balance of clarity/size
MAX_PAGES = 50    # safety cap; tune later via tier


@dataclass
class TextBlock:
    id: str            # stable: "p{page}-b{block}-l{line}-s{span}"
    text: str
    bbox: list[float]  # [x0, y0, x1, y1] in PDF points (origin top-left)
    font_name: str
    font_size: float
    color: int         # sRGB integer (0xRRGGBB)
    bold: bool
    italic: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "text": self.text,
            "bbox": self.bbox,
            "fontName": self.font_name,
            "fontSize": self.font_size,
            "color": self.color,
            "bold": self.bold,
            "italic": self.italic,
        }


@dataclass
class ParsedPage:
    page_number: int
    width_pt: float
    height_pt: float
    image_png_b64: str
    image_width_px: int
    image_height_px: int
    blocks: list[TextBlock] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "pageNumber": self.page_number,
            "widthPt": self.width_pt,
            "heightPt": self.height_pt,
            "imagePngB64": self.image_png_b64,
            "imageWidthPx": self.image_width_px,
            "imageHeightPx": self.image_height_px,
            "blocks": [b.to_dict() for b in self.blocks],
        }


def _is_bold(flags: int, font: str) -> bool:
    return bool(flags & 16) or "Bold" in font


def _is_italic(flags: int, font: str) -> bool:
    return bool(flags & 2) or "Italic" in font or "Oblique" in font


def parse_pdf(pdf_bytes: bytes) -> dict[str, Any]:
    """Return all editable text spans + page raster images."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if doc.page_count > MAX_PAGES:
        doc.close()
        raise ValueError(f"PDF has {doc.page_count} pages; max {MAX_PAGES} per request")

    pages: list[ParsedPage] = []
    for page_idx in range(doc.page_count):
        page = doc[page_idx]
        rect = page.rect

        # Render page to PNG for the visual layer in the editor.
        zoom = RENDER_DPI / 72.0
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        png_bytes = pix.tobytes("png")
        b64 = base64.b64encode(png_bytes).decode("ascii")

        parsed = ParsedPage(
            page_number=page_idx + 1,
            width_pt=rect.width,
            height_pt=rect.height,
            image_png_b64=b64,
            image_width_px=pix.width,
            image_height_px=pix.height,
        )

        # Extract all spans with full font/style info via the "dict" mode.
        text_dict = page.get_text("dict")
        for b_i, block in enumerate(text_dict.get("blocks", [])):
            if block.get("type") != 0:  # 0 = text, 1 = image
                continue
            for l_i, line in enumerate(block.get("lines", [])):
                for s_i, span in enumerate(line.get("spans", [])):
                    txt = (span.get("text") or "").strip()
                    if not txt:
                        continue
                    parsed.blocks.append(TextBlock(
                        id=f"p{page_idx + 1}-b{b_i}-l{l_i}-s{s_i}",
                        text=span["text"],  # keep original (with whitespace)
                        bbox=list(span["bbox"]),
                        font_name=span.get("font", "Helvetica"),
                        font_size=float(span.get("size", 12.0)),
                        color=int(span.get("color", 0)),
                        bold=_is_bold(span.get("flags", 0), span.get("font", "")),
                        italic=_is_italic(span.get("flags", 0), span.get("font", "")),
                    ))

        pages.append(parsed)

    result = {
        "pageCount": doc.page_count,
        "pages": [p.to_dict() for p in pages],
    }
    doc.close()
    return result


def _resolve_builtin_font(font_name: str, bold: bool, italic: bool) -> str:
    """Map a PDF font name to a PyMuPDF built-in font that's always embeddable.

    PyMuPDF can't always preserve custom embedded fonts during text re-insertion.
    We fall back to the closest built-in (Helvetica / Times / Courier) so that
    redactions look correct without needing to ship font files.
    """
    name = font_name.lower()
    if "times" in name or "serif" in name:
        base = "tiro"  # Times-Roman family
        if bold and italic:
            return "tibi"
        if bold:
            return "tibo"
        if italic:
            return "tiit"
        return base
    if "courier" in name or "mono" in name:
        if bold and italic:
            return "cobi"
        if bold:
            return "cobo"
        if italic:
            return "coit"
        return "cour"
    # Default: Helvetica family
    if bold and italic:
        return "hebi"
    if bold:
        return "hebo"
    if italic:
        return "heit"
    return "helv"


def _color_to_rgb(color_int: int) -> tuple[float, float, float]:
    r = ((color_int >> 16) & 0xFF) / 255.0
    g = ((color_int >> 8) & 0xFF) / 255.0
    b = (color_int & 0xFF) / 255.0
    return r, g, b


def apply_edits(pdf_bytes: bytes, edits: list[dict[str, Any]]) -> bytes:
    """Apply a list of {pageNumber, blockId, newText} edits and return new PDF bytes.

    Strategy: redact the original span (white rectangle), then draw the
    replacement text inside the same bbox using a built-in font. Position
    is the original span's origin so layout is preserved.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # First pass: parse the doc the same way as parse_pdf so we can resolve
    # blockId → span metadata. We don't render images here.
    span_lookup: dict[tuple[int, str], dict[str, Any]] = {}
    for page_idx in range(doc.page_count):
        page = doc[page_idx]
        text_dict = page.get_text("dict")
        for b_i, block in enumerate(text_dict.get("blocks", [])):
            if block.get("type") != 0:
                continue
            for l_i, line in enumerate(block.get("lines", [])):
                for s_i, span in enumerate(line.get("spans", [])):
                    block_id = f"p{page_idx + 1}-b{b_i}-l{l_i}-s{s_i}"
                    span_lookup[(page_idx + 1, block_id)] = {
                        "bbox": list(span["bbox"]),
                        "font_name": span.get("font", "Helvetica"),
                        "font_size": float(span.get("size", 12.0)),
                        "color": int(span.get("color", 0)),
                        "flags": span.get("flags", 0),
                    }

    # Group edits by page, redact in batches per page.
    edits_by_page: dict[int, list[dict[str, Any]]] = {}
    for edit in edits:
        pn = int(edit["pageNumber"])
        edits_by_page.setdefault(pn, []).append(edit)

    for page_num, page_edits in edits_by_page.items():
        page = doc[page_num - 1]

        # Stage 1: add redaction annotations covering original spans.
        resolved: list[tuple[dict[str, Any], str]] = []
        for edit in page_edits:
            block_id = edit["blockId"]
            new_text = edit["newText"]
            meta = span_lookup.get((page_num, block_id))
            if not meta:
                continue
            bbox = fitz.Rect(*meta["bbox"])
            # Add 1pt padding so adjacent glyphs don't get clipped.
            redact_rect = fitz.Rect(bbox.x0 - 0.5, bbox.y0 - 0.5, bbox.x1 + 0.5, bbox.y1 + 0.5)
            page.add_redact_annot(redact_rect, fill=(1, 1, 1))
            resolved.append((meta, new_text))

        # Apply all redactions on this page in one go.
        page.apply_redactions()

        # Stage 2: re-insert the new text in the same position.
        for meta, new_text in resolved:
            bbox = fitz.Rect(*meta["bbox"])
            font_alias = _resolve_builtin_font(
                meta["font_name"],
                _is_bold(meta["flags"], meta["font_name"]),
                _is_italic(meta["flags"], meta["font_name"]),
            )
            color = _color_to_rgb(meta["color"])
            # Insert at the baseline (bbox.y1 minus a typographic adjustment).
            page.insert_text(
                fitz.Point(bbox.x0, bbox.y1 - meta["font_size"] * 0.15),
                new_text,
                fontname=font_alias,
                fontsize=meta["font_size"],
                color=color,
            )

    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True)
    doc.close()
    return out.getvalue()

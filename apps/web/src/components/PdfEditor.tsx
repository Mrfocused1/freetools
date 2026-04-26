"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Toast, useToast } from "./Toast";

const MAX_BYTES = 10 * 1024 * 1024;

type TextBlock = {
  id: string;
  text: string;
  bbox: [number, number, number, number];
  fontName: string;
  fontSize: number;
  color: number;
  bold: boolean;
  italic: boolean;
};

type PageData = {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  imagePngB64: string;
  imageWidthPx: number;
  imageHeightPx: number;
  blocks: TextBlock[];
};

type ParsedDoc = {
  sessionId: string;
  pageCount: number;
  pages: PageData[];
};

type State =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "ready"; doc: ParsedDoc }
  | { kind: "saving"; doc: ParsedDoc }
  | { kind: "saved"; doc: ParsedDoc; downloadUrl: string }
  | { kind: "error"; message: string };

const PAGE_TARGET_WIDTH_PX = 800;

function colorToCss(c: number): string {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

function fontFamilyFor(fontName: string): string {
  const f = fontName.toLowerCase();
  if (f.includes("times") || f.includes("serif")) return "Georgia, 'Times New Roman', serif";
  if (f.includes("courier") || f.includes("mono")) return "'Courier New', Menlo, monospace";
  return "system-ui, -apple-system, Helvetica, Arial, sans-serif";
}

export function PdfEditor() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [edits, setEdits] = useState<Record<string, string>>({}); // blockId -> new text
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const toast = useToast();

  const editCount = useMemo(() => Object.keys(edits).length, [edits]);

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_BYTES) {
        setState({ kind: "error", message: `File too large (max 10 MB).` });
        return;
      }
      if (file.type && file.type !== "application/pdf") {
        setState({ kind: "error", message: "Only PDF files are supported." });
        return;
      }

      setState({ kind: "uploading", fileName: file.name });
      setEdits({});
      toast.show("Parsing PDF…");

      try {
        const fd = new FormData();
        fd.append("file", file, file.name);
        const r = await fetch("/api/edit-pdf/parse", { method: "POST", body: fd });
        if (!r.ok) {
          const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
          throw new Error(err.error ?? `HTTP ${r.status}`);
        }
        const doc = (await r.json()) as ParsedDoc;
        if (!doc.pages?.length) {
          throw new Error("This PDF appears to be scanned or empty. OCR support is coming.");
        }
        // Heuristic: if a PDF has zero text blocks total, treat it as scanned.
        const totalBlocks = doc.pages.reduce((s, p) => s + p.blocks.length, 0);
        if (totalBlocks === 0) {
          throw new Error(
            "No editable text found — this looks like a scanned PDF. OCR support is coming."
          );
        }
        setState({ kind: "ready", doc });
        toast.show(`Parsed ${doc.pageCount} page${doc.pageCount === 1 ? "" : "s"} · ${totalBlocks} text spans`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Upload failed.";
        setState({ kind: "error", message: msg });
      }
    },
    [toast]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

  const onSave = useCallback(async () => {
    if (state.kind !== "ready") return;
    if (editCount === 0) {
      toast.show("No edits to save.");
      return;
    }

    setState({ kind: "saving", doc: state.doc });
    toast.show("Applying edits…");

    const editList: { pageNumber: number; blockId: string; newText: string }[] = [];
    for (const page of state.doc.pages) {
      for (const block of page.blocks) {
        if (block.id in edits && edits[block.id] !== block.text) {
          editList.push({
            pageNumber: page.pageNumber,
            blockId: block.id,
            newText: edits[block.id],
          });
        }
      }
    }

    try {
      const r = await fetch("/api/edit-pdf/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.doc.sessionId, edits: editList }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const { downloadUrl } = (await r.json()) as { downloadUrl: string };
      setState({ kind: "saved", doc: state.doc, downloadUrl });
      toast.show("PDF saved.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed.";
      setState({ kind: "error", message: msg });
    }
  }, [edits, editCount, state, toast]);

  const onReset = useCallback(() => {
    setState({ kind: "idle" });
    setEdits({});
  }, []);

  // ----- Render --------------------------------------------------------

  if (state.kind === "idle" || state.kind === "error" || state.kind === "uploading") {
    return (
      <div className="mx-auto max-w-2xl">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition ${
            dragging
              ? "border-[var(--color-accent)] bg-[var(--color-surface)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]"
          }`}
          onClick={() => fileRef.current?.click()}
        >
          {state.kind === "uploading" ? (
            <p className="text-sm text-[var(--color-muted)]">
              Uploading & parsing <span className="font-medium">{state.fileName}</span>…
            </p>
          ) : (
            <>
              <p className="text-lg font-medium">Drop a PDF here</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                or click to browse · max 10 MB · 50 pages
              </p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={onPick}
          />
        </div>
        {state.kind === "error" && (
          <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">
            {state.message}
          </div>
        )}
        <Toast />
      </div>
    );
  }

  const doc = state.doc;
  const isSaving = state.kind === "saving";
  const saved = state.kind === "saved" ? state : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="sticky top-16 z-30 flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]/90 px-4 py-3 backdrop-blur">
        <div className="text-sm text-[var(--color-muted)]">
          {doc.pageCount} page{doc.pageCount === 1 ? "" : "s"} ·{" "}
          <span className="font-medium text-[var(--color-fg)]">{editCount}</span> edit
          {editCount === 1 ? "" : "s"} pending
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)]"
          >
            New PDF
          </button>
          {saved ? (
            <a
              href={saved.downloadUrl}
              download="edited.pdf"
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Download edited PDF
            </a>
          ) : (
            <button
              onClick={onSave}
              disabled={isSaving || editCount === 0}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save & download"}
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-8">
        {doc.pages.map((page) => (
          <PageView
            key={page.pageNumber}
            page={page}
            edits={edits}
            onEdit={(blockId, value) =>
              setEdits((prev) => ({ ...prev, [blockId]: value }))
            }
          />
        ))}
      </div>
      <Toast />
    </div>
  );
}

function PageView({
  page,
  edits,
  onEdit,
}: {
  page: PageData;
  edits: Record<string, string>;
  onEdit: (blockId: string, value: string) => void;
}) {
  // Scale: page in points → rendered container in pixels.
  const scale = PAGE_TARGET_WIDTH_PX / page.widthPt;
  const heightPx = page.heightPt * scale;

  return (
    <div className="rounded-md border border-[var(--color-border)] shadow-sm">
      <div
        className="relative bg-white"
        style={{ width: PAGE_TARGET_WIDTH_PX, height: heightPx }}
      >
        {/* Background: rendered PDF page as PNG */}
        <img
          src={`data:image/png;base64,${page.imagePngB64}`}
          alt={`Page ${page.pageNumber}`}
          className="absolute inset-0 h-full w-full select-none"
          draggable={false}
        />
        {/* Editable text overlays */}
        {page.blocks.map((block) => {
          const left = block.bbox[0] * scale;
          const top = block.bbox[1] * scale;
          const width = (block.bbox[2] - block.bbox[0]) * scale;
          const height = (block.bbox[3] - block.bbox[1]) * scale;
          const fontSizePx = block.fontSize * scale;
          const value = edits[block.id] ?? block.text;
          const isEdited = block.id in edits && edits[block.id] !== block.text;

          return (
            <input
              key={block.id}
              type="text"
              value={value}
              onChange={(e) => onEdit(block.id, e.target.value)}
              spellCheck={false}
              style={{
                position: "absolute",
                left,
                top,
                width,
                height,
                fontSize: fontSizePx,
                fontFamily: fontFamilyFor(block.fontName),
                fontWeight: block.bold ? 600 : 400,
                fontStyle: block.italic ? "italic" : "normal",
                color: colorToCss(block.color),
                background: isEdited ? "rgba(255, 240, 0, 0.55)" : "white",
                border: "1px solid transparent",
                borderRadius: 2,
                padding: 0,
                lineHeight: 1,
                outline: "none",
                whiteSpace: "nowrap",
                overflow: "visible",
              }}
              onFocus={(e) => (e.currentTarget.style.border = "1px solid var(--color-accent)")}
              onBlur={(e) => (e.currentTarget.style.border = "1px solid transparent")}
            />
          );
        })}
      </div>
      <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-muted)]">
        Page {page.pageNumber} of {page.imageWidthPx}×{page.imageHeightPx}px · {page.blocks.length} editable spans
      </div>
    </div>
  );
}

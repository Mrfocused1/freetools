"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Toast, useToast } from "./Toast";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const SUGGESTION_CHIPS = [
  "Make it black and white",
  "Add a sunset background",
  "Remove the watermark",
  "Make it look like an oil painting",
  "Replace the text with 'HELLO'",
];

const LOADING_MESSAGES = [
  "Loading the model…",
  "Analyzing your image…",
  "Generating the edit…",
];

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppState =
  | { kind: "idle" }
  | { kind: "loading"; originalDataUrl: string }
  | { kind: "done"; originalDataUrl: string; editedUrl: string }
  | { kind: "error"; message: string; rateLimited: boolean; originalDataUrl: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImageEditUI() {
  const [state, setState] = useState<AppState>({ kind: "idle" });
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // Rotate loading message every 3 s
  useEffect(() => {
    if (state.kind !== "loading") return;
    setLoadingMsgIdx(0);
    const id = setInterval(() => {
      setLoadingMsgIdx((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(id);
  }, [state.kind]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        toast.show("Only PNG, JPEG, and WebP images are supported.", {
          tone: "error",
        });
        return;
      }
      if (file.size > MAX_BYTES) {
        toast.show("Image too large — maximum size is 10 MB.", { tone: "error" });
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setImageDataUrl(dataUrl);
        setState({ kind: "idle" });
      } catch {
        toast.show("Could not read the image file.", { tone: "error" });
      }
    },
    [toast]
  );

  // Drag-and-drop handlers
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);
  const onDragLeave = useCallback(() => setDragging(false), []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      // Reset so same file can be re-selected
      e.target.value = "";
    },
    [handleFile]
  );

  const onApply = useCallback(async () => {
    if (!imageDataUrl || !prompt.trim()) return;
    const originalDataUrl = imageDataUrl;
    setState({ kind: "loading", originalDataUrl });
    try {
      const r = await fetch("/api/edit-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageDataUrl, prompt: prompt.trim() }),
      });
      const json = (await r.json()) as {
        editedUrl?: string;
        error?: string;
        rateLimited?: boolean;
        upstream?: boolean;
      };
      if (!r.ok) {
        setState({
          kind: "error",
          message: json.error ?? `HTTP ${r.status}`,
          rateLimited: r.status === 429 && !json.upstream,
          originalDataUrl,
        });
        return;
      }
      if (!json.editedUrl) {
        setState({
          kind: "error",
          message: "No output image returned.",
          rateLimited: false,
          originalDataUrl,
        });
        return;
      }
      setState({ kind: "done", originalDataUrl, editedUrl: json.editedUrl });
      toast.show("Edit complete — download it before the link expires.");
    } catch {
      setState({
        kind: "error",
        message: "Request failed. Check your connection and try again.",
        rateLimited: false,
        originalDataUrl,
      });
    }
  }, [imageDataUrl, prompt, toast]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void onApply();
      }
    },
    [onApply]
  );

  const onTryAnother = useCallback(() => {
    setPrompt("");
    if (state.kind === "done" || state.kind === "error") {
      setState({ kind: "idle" });
    }
  }, [state.kind]);

  const onStartOver = useCallback(() => {
    setImageDataUrl(null);
    setPrompt("");
    setState({ kind: "idle" });
  }, []);

  const onDownload = useCallback(() => {
    if (state.kind !== "done") return;
    const a = document.createElement("a");
    a.href = state.editedUrl;
    a.download = "quickfix-edit.png";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  }, [state]);

  const isLoading = state.kind === "loading";
  const isDone = state.kind === "done";
  const isError = state.kind === "error";

  const previewDataUrl =
    state.kind === "loading" || state.kind === "done" || state.kind === "error"
      ? state.originalDataUrl
      : imageDataUrl;

  return (
    <div className="space-y-6">
      {/* Upload zone — always shown until we have a done image */}
      {!isDone && (
        <div
          className={`rounded-2xl border-2 border-dashed transition ${
            dragging
              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
              : "border-[var(--color-border)] bg-[var(--color-surface)]"
          } p-6`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {previewDataUrl ? (
            /* Image selected — show preview + prompt */
            <div className="space-y-4">
              {/* Thumbnail */}
              <div className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewDataUrl}
                  alt="Selected image preview"
                  className="max-h-64 max-w-full rounded-lg object-contain shadow"
                />
              </div>

              {/* Swap image button */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                  className="text-xs text-[var(--color-muted)] underline hover:text-[var(--color-fg)] disabled:opacity-50"
                >
                  Change image
                </button>
              </div>

              {/* Prompt textarea */}
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="e.g. 'change the background to a beach', 'remove the person on the right', 'add neon lights'"
                rows={3}
                disabled={isLoading}
                className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
              />

              {/* Suggestion chips */}
              <div className="flex flex-wrap gap-2">
                {SUGGESTION_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={isLoading}
                    onClick={() => setPrompt(chip)}
                    className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-fg)] disabled:opacity-50"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-[var(--color-muted)]">
                  {prompt.length}/500 · ⌘+Enter
                </span>
                <button
                  type="button"
                  onClick={onApply}
                  disabled={isLoading || !prompt.trim()}
                  className="rounded-md bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {isLoading ? "Editing…" : "Apply edit"}
                </button>
              </div>
            </div>
          ) : (
            /* No image yet — show drop zone */
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-3 py-8 text-center"
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-[var(--color-muted)]"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className="text-sm font-medium">
                Drop an image here, or click to browse
              </span>
              <span className="text-xs text-[var(--color-muted)]">
                PNG, JPEG, WebP · max 10 MB
              </span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onFileInput}
          />
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <p className="text-sm font-medium">
            {LOADING_MESSAGES[loadingMsgIdx]}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Editing your image — typically 5–10 seconds…
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--color-accent)]" />
          </div>
        </div>
      )}

      {/* Done state — side-by-side comparison */}
      {isDone && (
        <div className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-[var(--color-muted)]">Original</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.originalDataUrl}
                alt="Original"
                className="w-full rounded-lg object-contain"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-[var(--color-muted)]">Edited</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.editedUrl}
                alt="Edited result"
                className="w-full rounded-lg object-contain"
              />
            </div>
          </div>

          <p className="text-xs text-[var(--color-muted)]">
            The edited image is hosted by fal.ai and will expire — download it
            to keep it permanently.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDownload}
              className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Download edited
            </button>
            <button
              type="button"
              onClick={onTryAnother}
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:border-[var(--color-accent)]"
            >
              Try another prompt
            </button>
            <button
              type="button"
              onClick={onStartOver}
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:border-[var(--color-accent)]"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-5">
          <p className="text-sm font-medium text-red-500">{state.message}</p>
          {!state.rateLimited && (
            <button
              type="button"
              onClick={() => setState({ kind: "idle" })}
              className="mt-3 rounded-md border border-red-500/40 px-4 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {/* After error: restore prompt UI so user can retry (if not rate-limited) */}
      {isError && !state.rateLimited && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={state.originalDataUrl}
              alt="Selected image"
              className="max-h-48 rounded-lg object-contain"
            />
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            disabled={isLoading}
            className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <div className="flex flex-wrap gap-2">
            {SUGGESTION_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setPrompt(chip)}
                className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]"
              >
                {chip}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onStartOver}
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:border-[var(--color-accent)]"
            >
              Start over
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={!prompt.trim()}
              className="rounded-md bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Apply edit
            </button>
          </div>
        </div>
      )}

      <Toast />
    </div>
  );
}

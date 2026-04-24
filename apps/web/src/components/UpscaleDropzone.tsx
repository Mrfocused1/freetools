"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BeforeAfterSlider } from "./BeforeAfterSlider";
import { Toast, useToast } from "./Toast";
import { MadeWithFooter } from "./MadeWithFooter";
import { ShareButton } from "./ShareButton";
import { ExportControls, formatToMime, type ExportSettings } from "./ExportControls";

type Scale = 2 | 4;

type JobState =
  | { status: "idle" }
  | { status: "uploading"; beforeUrl: string; dims?: { w: number; h: number } }
  | { status: "queued" | "processing"; jobId: string; beforeUrl: string; dims?: { w: number; h: number } }
  | { status: "succeeded"; jobId: string; outputUrl: string; beforeUrl: string; dims?: { w: number; h: number } }
  | { status: "failed"; error: string };

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 20 * 1024 * 1024;

export function UpscaleDropzone() {
  const [state, setState] = useState<JobState>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const [scale, setScale] = useState<Scale>(2);
  const [urlInput, setUrlInput] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyOn, setNotifyOn] = useState(false);
  const toast = useToast();
  const stateRef = useRef(state);
  stateRef.current = state;

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_BYTES) {
        setState({ status: "failed", error: `File too large (max 20 MB, was ${(file.size / 1024 / 1024).toFixed(1)} MB).` });
        return;
      }
      if (!ALLOWED.includes(file.type)) {
        setState({ status: "failed", error: `Unsupported format: ${file.type || "unknown"}.` });
        return;
      }

      const beforeUrl = URL.createObjectURL(file);
      let dims: { w: number; h: number } | undefined;
      try {
        dims = await new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = rej;
          img.src = beforeUrl;
        });
      } catch {}

      try {
        setState({ status: "uploading", beforeUrl, dims });
        toast.show("Uploading…");
        const initRes = await fetch("/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            sizeBytes: file.size,
            tool: "upscale",
            scale,
            notifyEmail: notifyOn && notifyEmail ? notifyEmail : undefined,
          }),
        });
        if (!initRes.ok) {
          const err = await initRes.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(err.error ?? `HTTP ${initRes.status}`);
        }
        const { jobId, uploadUrl, inputPath } = await initRes.json();
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": file.type },
          body: file,
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        const enq = await fetch(`/api/jobs/${jobId}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inputPath }),
        });
        if (!enq.ok) {
          const err = await enq.json().catch(() => ({ error: "Enqueue failed" }));
          throw new Error(err.error ?? `HTTP ${enq.status}`);
        }
        setState({ status: "queued", jobId, beforeUrl, dims });
        toast.show("Uploaded — upscaling");
        await pollJob(jobId, beforeUrl, dims, setState);
      } catch (e) {
        setState({ status: "failed", error: e instanceof Error ? e.message : "Unknown error" });
      }
    },
    [scale, toast, notifyEmail, notifyOn]
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const s = stateRef.current.status;
      if (s !== "idle" && s !== "failed") return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFile(file);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFile]);

  async function handleUrl(url: string) {
    if (!url) return;
    setUrlLoading(true);
    try {
      const r = await fetch("/api/fetch-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "URL fetch failed" }));
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const type = blob.type || "image/jpeg";
      const file = new File([blob], `url-${Date.now()}.${type.split("/")[1] ?? "jpg"}`, { type });
      setUrlInput("");
      await handleFile(file);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "URL fetch failed", { tone: "error" });
    } finally {
      setUrlLoading(false);
    }
  }

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="w-full">
      {(state.status === "idle" || state.status === "failed") && (
        <>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-14 text-center transition ${
              dragging ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10" : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
            }`}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--color-muted)]">
              <path d="M3 12h18M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="mt-4 text-lg font-medium">Drop an image, click to choose, or press ⌘V</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Upscale 2× or 4× with the Swin2SR open-source model
            </p>
            {state.status === "failed" && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>

          <div className="mt-4 flex gap-2">
            <input
              type="url"
              placeholder="or paste an image URL…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUrl(urlInput);
              }}
              className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              disabled={!urlInput || urlLoading}
              onClick={() => handleUrl(urlInput)}
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-50"
            >
              {urlLoading ? "Loading…" : "Fetch"}
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <p className="mb-2 text-sm font-medium">Upscale factor</p>
            <div className="flex gap-2">
              {[2, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => setScale(s as Scale)}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm transition ${
                    scale === s
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15"
                      : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                  }`}
                >
                  <span className="block text-lg font-semibold">{s}×</span>
                  <span className="block text-xs">
                    {s === 2
                      ? "Lightweight Swin2SR — ~60s on CPU"
                      : "Real-world BSRGAN-tuned — ~3-5 min on CPU"}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              Input is capped at 4 megapixels on CPU to keep runtime reasonable. Output will be {scale}× the (possibly downscaled) input.
            </p>

            <div className="mt-4 flex items-start justify-between gap-4 border-t border-[var(--color-border)] pt-4">
              <div className="flex-1">
                <label htmlFor="upscale-notify" className="block text-sm font-medium cursor-pointer">
                  Email me when it's done
                </label>
                <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                  Useful since 4× can take a few minutes on CPU.
                </p>
              </div>
              <button
                id="upscale-notify"
                role="switch"
                aria-checked={notifyOn}
                onClick={() => setNotifyOn((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                  notifyOn ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
                    notifyOn ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            {notifyOn && (
              <input
                type="email"
                placeholder="you@example.com"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            )}
          </div>
        </>
      )}

      {(state.status === "uploading" || state.status === "queued" || state.status === "processing") && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
          <p className="text-lg font-medium">
            {state.status === "uploading" ? "Uploading…" : state.status === "queued" ? "Queued" : "Upscaling…"}
          </p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Swin2SR is working. This takes {scale === 2 ? "about a minute" : "a few minutes"} on CPU.
          </p>
          {state.dims && (
            <p className="mt-3 text-xs text-[var(--color-muted)]">
              Input: {state.dims.w}×{state.dims.h} → target {state.dims.w * scale}×{state.dims.h * scale}
            </p>
          )}
        </div>
      )}

      {state.status === "succeeded" && (
        <UpscaleResult
          jobId={state.jobId}
          beforeUrl={state.beforeUrl}
          outputUrl={state.outputUrl}
          dims={state.dims}
          scale={scale}
          onReset={() => {
            URL.revokeObjectURL(state.beforeUrl);
            setState({ status: "idle" });
          }}
        />
      )}

      <Toast />
    </div>
  );
}

function UpscaleResult({
  jobId,
  beforeUrl,
  outputUrl,
  dims,
  scale,
  onReset,
}: {
  jobId: string;
  beforeUrl: string;
  outputUrl: string;
  dims?: { w: number; h: number };
  scale: Scale;
  onReset: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    format: "png",
    quality: 92,
    size: null,
  });
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
    };
    img.src = outputUrl;
    return () => {
      cancelled = true;
    };
  }, [outputUrl]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const blob = await encodeImage(img, exportSettings);
        if (!cancelled) setEstimatedBytes(blob.size);
      } catch {
        if (!cancelled) setEstimatedBytes(null);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [exportSettings]);

  async function onDownload() {
    try {
      setDownloading(true);
      const img = imgRef.current;
      if (!img) throw new Error("Not ready");
      const blob = await encodeImage(img, exportSettings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quickfix-upscaled-${scale}x.${exportSettings.format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(outputUrl);
      toast.show("Result link copied");
    } catch {
      toast.show("Couldn't copy", { tone: "error" });
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <div className="mb-4 overflow-hidden rounded-lg">
        <BeforeAfterSlider beforeUrl={beforeUrl} afterUrl={outputUrl} />
      </div>
      <div className="mb-4 flex items-center justify-between text-xs text-[var(--color-muted)]">
        <span>Drag the slider to compare detail</span>
        {dims && (
          <span>
            {dims.w}×{dims.h} → {dims.w * scale}×{dims.h * scale}
          </span>
        )}
      </div>

      <div className="mb-6">
        <ExportControls
          settings={exportSettings}
          onChange={setExportSettings}
          estimatedBytes={estimatedBytes}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={onDownload}
          disabled={downloading}
          className="flex-1 min-w-[180px] rounded-md bg-[var(--color-accent)] px-4 py-2 font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
        >
          {downloading ? "Downloading…" : "Download upscaled image"}
        </button>
        <ShareButton jobId={jobId} />
        <button onClick={onCopyLink} className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm">
          Copy link
        </button>
        <button onClick={onReset} className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm">
          New image
        </button>
      </div>
      <MadeWithFooter />
    </div>
  );
}

async function encodeImage(img: HTMLImageElement, settings: ExportSettings): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = settings.size && settings.size.width > 0 ? settings.size.width : img.naturalWidth;
  canvas.height = settings.size && settings.size.height > 0 ? settings.size.height : img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const mime = formatToMime(settings.format);
  const quality = settings.format === "png" ? undefined : Math.max(0.4, Math.min(1, settings.quality / 100));
  return new Promise((res, rej) => {
    canvas.toBlob(
      (b) => {
        if (!b) return rej(new Error(`Browser cannot encode ${settings.format.toUpperCase()}`));
        res(b);
      },
      mime,
      quality
    );
  });
}

async function pollJob(
  jobId: string,
  beforeUrl: string,
  dims: { w: number; h: number } | undefined,
  setState: (s: JobState) => void
) {
  const started = Date.now();
  const timeoutMs = 15 * 60 * 1000; // upscale can take several minutes on CPU
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) continue;
    const data = (await res.json()) as { status: string; outputUrl?: string; error?: string };
    if (data.status === "processing") {
      setState({ status: "processing", jobId, beforeUrl, dims });
    } else if (data.status === "succeeded" && data.outputUrl) {
      setState({ status: "succeeded", jobId, outputUrl: data.outputUrl, beforeUrl, dims });
      return;
    } else if (data.status === "failed") {
      setState({ status: "failed", error: data.error ?? "Upscale failed" });
      return;
    }
  }
  setState({ status: "failed", error: "Timed out waiting for the upscaler." });
}

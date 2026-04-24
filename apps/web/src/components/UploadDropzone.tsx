"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BeforeAfterSlider } from "./BeforeAfterSlider";
import { BackgroundPicker, DEFAULT_BG, type Background } from "./BackgroundPicker";
import { DownloadPresets, type DownloadPreset } from "./DownloadPresets";
import { ExportControls, formatToMime, type ExportSettings, type OutputFormat } from "./ExportControls";
import { Toast, useToast } from "./Toast";
import { MadeWithFooter } from "./MadeWithFooter";
import { ShareButton } from "./ShareButton";

type ProcessingOptions = {
  hairMode: boolean;
  featherRadius: number;
  autoCrop: boolean;
};

type JobState =
  | { status: "idle" }
  | { status: "uploading"; beforeUrl: string; dims?: { w: number; h: number } }
  | { status: "queued" | "processing"; jobId: string; beforeUrl: string; dims?: { w: number; h: number } }
  | { status: "succeeded"; jobId: string; outputUrl: string; beforeUrl: string; dims?: { w: number; h: number } }
  | { status: "failed"; error: string };

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export function UploadDropzone() {
  const [state, setState] = useState<JobState>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const [options, setOptions] = useState<ProcessingOptions>({
    hairMode: false,
    featherRadius: 0.8,
    autoCrop: false,
  });
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
        setState({ status: "failed", error: `File too large — max 20 MB (this was ${(file.size / 1024 / 1024).toFixed(1)} MB).` });
        return;
      }
      if (!ALLOWED.includes(file.type)) {
        setState({ status: "failed", error: `Unsupported format "${file.type || "unknown"}". Use JPG, PNG, or WebP.` });
        return;
      }

      const beforeUrl = URL.createObjectURL(file);

      // Read input dimensions client-side for UI.
      let dims: { w: number; h: number } | undefined;
      try {
        dims = await new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = rej;
          img.src = beforeUrl;
        });
      } catch {
        dims = undefined;
      }

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
            hairMode: options.hairMode,
            featherRadius: options.featherRadius,
            autoCrop: options.autoCrop,
            notifyEmail: notifyOn && notifyEmail ? notifyEmail : undefined,
          }),
        });
        if (!initRes.ok) {
          const err = await initRes.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(prettifyError(err.error, initRes.status));
        }
        const { jobId, uploadUrl, inputPath } = await initRes.json();

        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": file.type },
          body: file,
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status}). Please try again.`);

        const enqueueRes = await fetch(`/api/jobs/${jobId}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inputPath }),
        });
        if (!enqueueRes.ok) {
          const err = await enqueueRes.json().catch(() => ({ error: "Couldn't start processing" }));
          throw new Error(prettifyError(err.error, enqueueRes.status));
        }

        setState({ status: "queued", jobId, beforeUrl, dims });
        toast.show("Uploaded — now processing");
        await pollJob(jobId, beforeUrl, dims, setState);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setState({ status: "failed", error: msg });
        toast.show("Something went wrong", { tone: "error" });
      }
    },
    [options, toast, notifyEmail, notifyOn]
  );

  const handleUrl = useCallback(
    async (url: string) => {
      if (!url) return;
      setUrlLoading(true);
      try {
        const res = await fetch("/api/fetch-image", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "URL fetch failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const type = blob.type || "image/jpeg";
        const ext = type.split("/")[1] ?? "jpg";
        const fname = `url-${Date.now()}.${ext}`;
        const file = new File([blob], fname, { type });
        setUrlInput("");
        await handleFile(file);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "URL fetch failed";
        toast.show(msg, { tone: "error" });
      } finally {
        setUrlLoading(false);
      }
    },
    [handleFile, toast]
  );

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  // A1 — Paste-from-clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Don't hijack paste when the user is focused on a text input (e.g. URL field).
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      // Only handle when we're idle / failed (not during active job).
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

  return (
    <div className="w-full">
      {state.status === "idle" || state.status === "failed" ? (
        <>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-14 text-center transition ${
              dragging
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
            }`}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--color-muted)]">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="mt-4 text-lg font-medium">Drop an image, click to choose, or press ⌘V</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">JPG, PNG, or WebP up to 20 MB</p>
            {state.status === "failed" && (
              <p className="mt-4 max-w-md text-sm text-red-400">{state.error}</p>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={onChange}
            />
          </label>

          {/* URL input */}
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
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {urlLoading ? "Loading…" : "Fetch"}
            </button>
          </div>

          {/* Options panel */}
          <div className="mt-4 space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <ToggleRow
              id="hair-mode"
              label="Fine hair & edges"
              subtitle="BiRefNet-matting model — pixel-perfect on hair & fur. Takes ~2× longer."
              checked={options.hairMode}
              onChange={(v) => setOptions((o) => ({ ...o, hairMode: v }))}
            />
            <ToggleRow
              id="auto-crop"
              label="Auto-crop to subject"
              subtitle="Tight crop around the detected subject with 5% padding."
              checked={options.autoCrop}
              onChange={(v) => setOptions((o) => ({ ...o, autoCrop: v }))}
            />
            <SliderRow
              id="feather"
              label="Edge softness"
              subtitle="Higher = softer edges. Useful for hair, hurts hard-edged products."
              min={0}
              max={3}
              step={0.1}
              value={options.featherRadius}
              onChange={(v) => setOptions((o) => ({ ...o, featherRadius: v }))}
            />
            <div className="flex flex-col gap-2 pt-1">
              <ToggleRow
                id="notify"
                label="Email me when it's done"
                subtitle="Skip the wait — we'll send a download link to your inbox."
                checked={notifyOn}
                onChange={(v) => setNotifyOn(v)}
              />
              {notifyOn && (
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.value)}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                />
              )}
            </div>
          </div>
        </>
      ) : null}

      {(state.status === "uploading" || state.status === "queued" || state.status === "processing") && (
        <StatusCard
          title={
            state.status === "uploading"
              ? "Uploading…"
              : state.status === "queued"
                ? "Queued"
                : "Removing background…"
          }
          subtitle={
            state.status === "uploading"
              ? "Sending your image."
              : state.status === "queued"
                ? "Waiting for a worker."
                : "The AI is working. This usually takes 30-60 seconds."
          }
          dims={state.dims}
        />
      )}

      {state.status === "succeeded" && (
        <ResultCard
          jobId={state.jobId}
          beforeUrl={state.beforeUrl}
          outputUrl={state.outputUrl}
          dims={state.dims}
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

function ToggleRow({
  id,
  label,
  subtitle,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  subtitle: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <label htmlFor={id} className="block text-sm font-medium cursor-pointer">
          {label}
        </label>
        <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p>
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function SliderRow({
  id,
  label,
  subtitle,
  min,
  max,
  step,
  value,
  onChange,
}: {
  id: string;
  label: string;
  subtitle: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="text-xs tabular-nums text-[var(--color-muted)]">{value.toFixed(1)} px</span>
      </div>
      <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--color-accent)]"
      />
    </div>
  );
}

function StatusCard({
  title,
  subtitle,
  dims,
}: {
  title: string;
  subtitle: string;
  dims?: { w: number; h: number };
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
      <p className="text-lg font-medium">{title}</p>
      <p className="mt-1 text-sm text-[var(--color-muted)]">{subtitle}</p>
      {dims && (
        <p className="mt-3 text-xs text-[var(--color-muted)]">Input: {dims.w}×{dims.h}</p>
      )}
    </div>
  );
}

function ResultCard({
  jobId,
  beforeUrl,
  outputUrl,
  dims,
  onReset,
}: {
  jobId: string;
  beforeUrl: string;
  outputUrl: string;
  dims?: { w: number; h: number };
  onReset: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [background, setBackground] = useState<Background>(DEFAULT_BG);
  const [compositedUrl, setCompositedUrl] = useState<string | null>(null);
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    format: "png",
    quality: 92,
    size: null,
  });
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null);
  const baseImgRef = useRef<HTMLImageElement | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      baseImgRef.current = img;
      const url = compositeOntoBackground(img, background);
      setCompositedUrl(url);
    };
    img.src = outputUrl;
    return () => {
      cancelled = true;
    };
  }, [outputUrl, background]);

  // Estimate output file size whenever settings change. Debounced to avoid
  // re-rendering the canvas on every quality-slider tick.
  useEffect(() => {
    const img = baseImgRef.current;
    if (!img) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const blob = await renderForDownloadBlob(img, background, exportSettings);
        if (cancelled) return;
        setEstimatedBytes(blob.size);
      } catch {
        if (!cancelled) setEstimatedBytes(null);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [background, exportSettings]);

  async function handleDownload() {
    try {
      setDownloading(true);
      const img = baseImgRef.current;
      if (!img) throw new Error("Image not ready");
      const blob = await renderForDownloadBlob(img, background, exportSettings);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const suffix =
        background.kind === "transparent"
          ? "cutout"
          : `${background.kind === "solid" ? "solid" : "gradient"}-bg`;
      a.download = `quickfix-${suffix}.${exportSettings.format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not download");
    } finally {
      setDownloading(false);
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(outputUrl);
      toast.show("Result link copied");
    } catch {
      toast.show("Couldn't copy to clipboard", { tone: "error" });
    }
  }

  const displayUrl = compositedUrl ?? outputUrl;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <div className="mb-4 max-h-[60vh] overflow-hidden rounded-lg">
        <BeforeAfterSlider beforeUrl={beforeUrl} afterUrl={displayUrl} />
      </div>
      <div className="mb-4 flex items-center justify-between text-center text-xs text-[var(--color-muted)]">
        <span>Drag the slider to compare</span>
        {dims && <span>Output: {dims.w}×{dims.h}</span>}
      </div>

      <div className="mb-6">
        <BackgroundPicker value={background} onChange={setBackground} />
      </div>

      <div className="mb-6">
        <DownloadPresets
          value={exportSettings.size}
          onChange={(size) => setExportSettings((s) => ({ ...s, size }))}
          sourceDims={dims}
        />
      </div>

      <div className="mb-6">
        <ExportControls
          settings={exportSettings}
          onChange={setExportSettings}
          estimatedBytes={estimatedBytes}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex-1 min-w-[160px] rounded-md bg-[var(--color-accent)] px-4 py-2 text-center font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
        >
          {downloading
            ? "Downloading…"
            : background.kind === "transparent"
              ? "Download PNG"
              : "Download image"}
        </button>
        <ShareButton jobId={jobId} />
        <button
          onClick={handleCopyLink}
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm"
          title="Copy direct image URL"
        >
          Copy link
        </button>
        <button
          onClick={onReset}
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm"
        >
          New image
        </button>
      </div>

      <MadeWithFooter />
    </div>
  );
}

function compositeOntoBackground(img: HTMLImageElement, bg: Background): string {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return img.src;

  if (bg.kind === "transparent") {
    ctx.drawImage(img, 0, 0);
  } else if (bg.kind === "solid") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  } else {
    const angle = ((bg.angle - 90) * Math.PI) / 180;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const r = Math.hypot(canvas.width, canvas.height) / 2;
    const grad = ctx.createLinearGradient(
      cx - Math.cos(angle) * r,
      cy - Math.sin(angle) * r,
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r
    );
    grad.addColorStop(0, bg.from);
    grad.addColorStop(1, bg.to);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  }

  return canvas.toDataURL("image/png");
}

// Render the RGBA cutout (with optional background + target size) into a Blob.
// Supports PNG/JPG/WebP/AVIF with a user-chosen quality for lossy formats.
async function renderForDownloadBlob(
  img: HTMLImageElement,
  bg: Background,
  settings: ExportSettings
): Promise<Blob> {
  const hasSize = settings.size && settings.size.width > 0 && settings.size.height > 0;
  const targetW = hasSize ? settings.size!.width : img.naturalWidth;
  const targetH = hasSize ? settings.size!.height : img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  // Most lossy formats don't support transparency — JPG always flattens, AVIF
  // sometimes does depending on encoder. If the user picks a lossy format
  // while on transparent, fill white so they don't get black.
  const isLossy = settings.format !== "png";
  const effectiveBg: Background =
    bg.kind === "transparent" && isLossy && settings.format === "jpg"
      ? { kind: "solid", color: "#ffffff" }
      : bg;

  if (effectiveBg.kind === "solid") {
    ctx.fillStyle = effectiveBg.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (effectiveBg.kind === "gradient") {
    const angle = ((effectiveBg.angle - 90) * Math.PI) / 180;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const r = Math.hypot(canvas.width, canvas.height) / 2;
    const grad = ctx.createLinearGradient(
      cx - Math.cos(angle) * r,
      cy - Math.sin(angle) * r,
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r
    );
    grad.addColorStop(0, effectiveBg.from);
    grad.addColorStop(1, effectiveBg.to);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Fit the cutout into the canvas (contain). If no size is chosen, draw 1:1.
  let dx = 0, dy = 0, drawW = canvas.width, drawH = canvas.height;
  if (hasSize) {
    const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
    drawW = img.naturalWidth * scale;
    drawH = img.naturalHeight * scale;
    dx = (canvas.width - drawW) / 2;
    dy = (canvas.height - drawH) / 2;
  }
  ctx.drawImage(img, dx, dy, drawW, drawH);

  const mime = formatToMime(settings.format);
  const quality = isLossy ? Math.max(0.4, Math.min(1, settings.quality / 100)) : undefined;

  return new Promise<Blob>((res, rej) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          rej(new Error(`Browser can't encode ${settings.format.toUpperCase()} — try a different format`));
          return;
        }
        res(blob);
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
  const timeoutMs = 180_000;
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1200));
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) continue;
    const data = (await res.json()) as {
      status: "queued" | "processing" | "succeeded" | "failed";
      outputUrl?: string;
      error?: string;
    };
    if (data.status === "processing") {
      setState({ status: "processing", jobId, beforeUrl, dims });
    } else if (data.status === "succeeded" && data.outputUrl) {
      setState({ status: "succeeded", jobId, outputUrl: data.outputUrl, beforeUrl, dims });
      return;
    } else if (data.status === "failed") {
      setState({ status: "failed", error: data.error ?? "Processing failed. Please try again." });
      return;
    }
  }
  setState({ status: "failed", error: "Timed out waiting for the result. Try a smaller image or try again in a moment." });
}

function prettifyError(raw: string | undefined, status: number): string {
  if (!raw) {
    if (status === 402) return "You've hit your monthly limit. Sign in and upgrade, or buy credits.";
    if (status === 413) return "File is too large.";
    if (status === 415) return "Unsupported file type.";
    if (status === 429) return "Too many requests. Please wait a moment.";
    return `Request failed (HTTP ${status}).`;
  }
  return raw;
}

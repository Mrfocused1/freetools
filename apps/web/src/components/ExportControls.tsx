"use client";

import { useEffect, useState } from "react";
import type { DownloadPreset } from "./DownloadPresets";

export type OutputFormat = "png" | "jpg" | "webp" | "avif";

export type ExportSettings = {
  format: OutputFormat;
  quality: number;   // 0-100, ignored for PNG
  size: DownloadPreset | null;
};

const FORMATS: { id: OutputFormat; label: string; mime: string; lossy: boolean; hint: string }[] = [
  { id: "png",  label: "PNG",  mime: "image/png",  lossy: false, hint: "Lossless, keeps transparency" },
  { id: "jpg",  label: "JPG",  mime: "image/jpeg", lossy: true,  hint: "Smallest files, no transparency" },
  { id: "webp", label: "WebP", mime: "image/webp", lossy: true,  hint: "Small + transparency — modern choice" },
  { id: "avif", label: "AVIF", mime: "image/avif", lossy: true,  hint: "Smallest of the lot, not universally supported" },
];

type Props = {
  settings: ExportSettings;
  onChange: (s: ExportSettings) => void;
  estimatedBytes: number | null;
};

export function ExportControls({ settings, onChange, estimatedBytes }: Props) {
  const active = FORMATS.find((f) => f.id === settings.format) ?? FORMATS[0];

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium">Format</p>
        <div className="flex flex-wrap gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => onChange({ ...settings, format: f.id })}
              className={`rounded-md border px-3 py-1.5 text-xs transition ${
                settings.format === f.id
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15"
                  : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">{active.hint}</p>
      </div>

      {active.lossy && (
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <label htmlFor="quality" className="text-sm font-medium">
              Quality
            </label>
            <span className="text-xs tabular-nums text-[var(--color-muted)]">
              {settings.quality}%
            </span>
          </div>
          <input
            id="quality"
            type="range"
            min={40}
            max={100}
            step={1}
            value={settings.quality}
            onChange={(e) => onChange({ ...settings, quality: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--color-accent)]"
          />
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Lower = smaller file. 85% is a good default for photos.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between rounded-md border border-dashed border-[var(--color-border)] px-3 py-2">
        <span className="text-xs text-[var(--color-muted)]">Estimated file size</span>
        <span className="text-xs font-medium tabular-nums">
          {estimatedBytes == null
            ? "…"
            : estimatedBytes > 1024 * 1024
              ? `${(estimatedBytes / 1024 / 1024).toFixed(2)} MB`
              : `${(estimatedBytes / 1024).toFixed(0)} KB`}
        </span>
      </div>
    </div>
  );
}

// Useful helper for callers.
export function formatToMime(f: OutputFormat): string {
  return (
    FORMATS.find((x) => x.id === f)?.mime ?? "image/png"
  );
}

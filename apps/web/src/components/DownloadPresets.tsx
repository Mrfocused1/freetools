"use client";

import { useState } from "react";

export type DownloadPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
  format: "png" | "jpg" | "webp";
};

const PRESETS: DownloadPreset[] = [
  { id: "original",       label: "Original",            width: 0,    height: 0,    format: "png" },
  { id: "ig-square",      label: "Instagram post",      width: 1080, height: 1080, format: "jpg" },
  { id: "ig-story",       label: "Instagram story",     width: 1080, height: 1920, format: "jpg" },
  { id: "shopify",        label: "Shopify product",     width: 2048, height: 2048, format: "jpg" },
  { id: "amazon",         label: "Amazon main",         width: 2000, height: 2000, format: "jpg" },
  { id: "linkedin",       label: "LinkedIn post",       width: 1200, height: 627,  format: "jpg" },
  { id: "tiktok",         label: "TikTok / Reels",      width: 1080, height: 1920, format: "jpg" },
  { id: "twitter",        label: "X / Twitter post",    width: 1600, height: 900,  format: "jpg" },
  { id: "favicon",        label: "Favicon 512",         width: 512,  height: 512,  format: "png" },
];

type Props = {
  value: DownloadPreset | null;
  onChange: (p: DownloadPreset | null) => void;
  sourceDims?: { w: number; h: number };
};

export function DownloadPresets({ value, onChange, sourceDims }: Props) {
  const [custom, setCustom] = useState({ w: 1024, h: 1024 });

  const activeId = value?.id ?? "original";

  return (
    <div>
      <p className="mb-2 text-sm font-medium">Download size</p>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onChange(p.id === "original" ? null : p)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              activeId === p.id
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-fg)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            {p.label}
            {p.width > 0 && (
              <span className="ml-1 text-[var(--color-muted)]">
                {p.width}×{p.height}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-[var(--color-muted)]">Custom:</span>
        <input
          type="number"
          min={16}
          max={8192}
          value={custom.w}
          onChange={(e) => setCustom({ ...custom, w: Number(e.target.value) })}
          className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 tabular-nums outline-none"
        />
        <span className="text-[var(--color-muted)]">×</span>
        <input
          type="number"
          min={16}
          max={8192}
          value={custom.h}
          onChange={(e) => setCustom({ ...custom, h: Number(e.target.value) })}
          className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 tabular-nums outline-none"
        />
        <button
          onClick={() =>
            onChange({
              id: "custom",
              label: `Custom ${custom.w}×${custom.h}`,
              width: custom.w,
              height: custom.h,
              format: "png",
            })
          }
          className="rounded-md border border-[var(--color-border)] px-2 py-1"
        >
          Apply
        </button>
      </div>
      {sourceDims && (
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Source resolution: {sourceDims.w}×{sourceDims.h}. Non-original presets fit the subject into the box with letterboxing where needed.
        </p>
      )}
    </div>
  );
}

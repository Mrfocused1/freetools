"use client";

import { useState } from "react";

export type Background =
  | { kind: "transparent" }
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angle: number };

export const DEFAULT_BG: Background = { kind: "transparent" };

type Preset = {
  id: string;
  label: string;
  value: Background;
  swatch: string; // css background value for the preview dot
};

const PRESETS: Preset[] = [
  {
    id: "transparent",
    label: "None",
    value: { kind: "transparent" },
    swatch:
      "repeating-conic-gradient(#444 0% 25%, #777 0% 50%) 50% / 12px 12px",
  },
  { id: "white",    label: "White",  value: { kind: "solid", color: "#ffffff" }, swatch: "#ffffff" },
  { id: "black",    label: "Black",  value: { kind: "solid", color: "#0a0a0b" }, swatch: "#0a0a0b" },
  { id: "gray",     label: "Studio", value: { kind: "solid", color: "#f3f4f6" }, swatch: "#f3f4f6" },
  { id: "dark",     label: "Slate",  value: { kind: "solid", color: "#1f2937" }, swatch: "#1f2937" },
  { id: "brand",    label: "Brand",  value: { kind: "solid", color: "#7c5cff" }, swatch: "#7c5cff" },
  {
    id: "sunset",
    label: "Sunset",
    value: { kind: "gradient", from: "#fbc2eb", to: "#a6c1ee", angle: 135 },
    swatch: "linear-gradient(135deg,#fbc2eb,#a6c1ee)",
  },
  {
    id: "ocean",
    label: "Ocean",
    value: { kind: "gradient", from: "#2193b0", to: "#6dd5ed", angle: 135 },
    swatch: "linear-gradient(135deg,#2193b0,#6dd5ed)",
  },
  {
    id: "flame",
    label: "Flame",
    value: { kind: "gradient", from: "#ff9966", to: "#ff5e62", angle: 135 },
    swatch: "linear-gradient(135deg,#ff9966,#ff5e62)",
  },
];

type Props = {
  value: Background;
  onChange: (bg: Background) => void;
};

export function BackgroundPicker({ value, onChange }: Props) {
  const activeId =
    value.kind === "transparent"
      ? "transparent"
      : PRESETS.find(
          (p) =>
            (p.value.kind === "solid" &&
              value.kind === "solid" &&
              p.value.color === value.color) ||
            (p.value.kind === "gradient" &&
              value.kind === "gradient" &&
              p.value.from === value.from &&
              p.value.to === value.to)
        )?.id ?? "custom";

  const currentColor = value.kind === "solid" ? value.color : "#7c5cff";
  const [customColor, setCustomColor] = useState(currentColor);

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-[var(--color-fg)]">Background</p>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onChange(p.value)}
            className={`group flex h-10 w-10 items-center justify-center rounded-full border-2 transition ${
              activeId === p.id
                ? "border-[var(--color-accent)]"
                : "border-[var(--color-border)] hover:border-[var(--color-fg)]/40"
            }`}
            aria-label={p.label}
            title={p.label}
            style={{ background: p.swatch }}
          />
        ))}
        <label
          className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-2 ${
            activeId === "custom"
              ? "border-[var(--color-accent)]"
              : "border-[var(--color-border)]"
          }`}
          style={{ background: customColor }}
          title="Custom color"
        >
          <input
            type="color"
            value={customColor}
            onChange={(e) => {
              setCustomColor(e.target.value);
              onChange({ kind: "solid", color: e.target.value });
            }}
            className="h-0 w-0 opacity-0"
          />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <circle cx="13.5" cy="6.5" r=".5" fill="white" />
            <circle cx="17.5" cy="10.5" r=".5" fill="white" />
            <circle cx="8.5" cy="7.5" r=".5" fill="white" />
            <circle cx="6.5" cy="12.5" r=".5" fill="white" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-1 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.52-4.48-10-10-10z" />
          </svg>
        </label>
      </div>
    </div>
  );
}

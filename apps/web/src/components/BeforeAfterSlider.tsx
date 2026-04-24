"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  beforeUrl: string;
  afterUrl: string;
  alt?: string;
};

// A draggable divider that reveals "before" on the left and "after" on the right.
// Works with mouse, touch, and keyboard.
export function BeforeAfterSlider({ beforeUrl, afterUrl, alt = "Before and after" }: Props) {
  const [position, setPosition] = useState(50); // percent
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const raw = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.max(0, Math.min(100, raw)));
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none overflow-hidden rounded-lg"
      style={{
        // Checkerboard so transparent PNG reads as transparent visually.
        backgroundImage:
          "linear-gradient(45deg, var(--color-checker-a) 25%, transparent 25%), linear-gradient(-45deg, var(--color-checker-a) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-checker-a) 75%), linear-gradient(-45deg, transparent 75%, var(--color-checker-a) 75%)",
        backgroundSize: "16px 16px",
        backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
      }}
      onMouseDown={(e) => {
        dragging.current = true;
        updateFromClientX(e.clientX);
      }}
      onMouseMove={(e) => {
        if (dragging.current) updateFromClientX(e.clientX);
      }}
      onMouseUp={() => {
        dragging.current = false;
      }}
      onMouseLeave={() => {
        dragging.current = false;
      }}
      onTouchStart={(e) => {
        dragging.current = true;
        updateFromClientX(e.touches[0].clientX);
      }}
      onTouchMove={(e) => {
        if (dragging.current) updateFromClientX(e.touches[0].clientX);
      }}
      onTouchEnd={() => {
        dragging.current = false;
      }}
    >
      {/* After image (full-size, underneath) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={afterUrl}
        alt={`${alt} — after`}
        draggable={false}
        className="block h-auto w-full"
      />

      {/* Before image clipped to the left of the slider */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${position}%` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt={`${alt} — before`}
          draggable={false}
          className="block h-auto"
          // Hold the image at the container's width so "before" and "after" align.
          style={{ width: `${100 * (100 / Math.max(position, 0.0001))}%`, maxWidth: "none" }}
        />
      </div>

      {/* Divider handle */}
      <div
        className="pointer-events-none absolute top-0 bottom-0"
        style={{ left: `calc(${position}% - 1px)` }}
      >
        <div className="h-full w-0.5 bg-white/90 shadow-[0_0_6px_rgba(0,0,0,0.4)]" />
        <div
          className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/90 bg-black/60 backdrop-blur"
          aria-hidden
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </div>
      </div>

      {/* A11y slider */}
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
        aria-label="Before and after slider"
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />

      {/* Corner labels */}
      <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white backdrop-blur">
        Before
      </span>
      <span className="absolute right-3 top-3 rounded-full bg-[var(--color-accent)]/90 px-2 py-0.5 text-xs text-white">
        After
      </span>
    </div>
  );
}

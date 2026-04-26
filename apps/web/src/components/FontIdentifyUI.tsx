"use client";

import { useCallback, useRef, useState } from "react";
import { Toast, useToast } from "./Toast";

// --------------------------------------------------------------------------- //
// Types                                                                         //
// --------------------------------------------------------------------------- //

type FontMatch = {
  family: string;
  style: string;
  source: "google" | "fontsource" | string;
  license: string;
  score: number;
  previewUrl: string;
  downloadUrl: string;
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; matches: FontMatch[]; imageUrl: string }
  | { kind: "error"; message: string };

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

// --------------------------------------------------------------------------- //
// Source badge helper                                                           //
// --------------------------------------------------------------------------- //

function SourceBadge({ source }: { source: string }) {
  const label =
    source === "google"
      ? "Google Fonts"
      : source === "fontsource"
        ? "Fontsource"
        : source === "squirrel"
          ? "Font Squirrel"
          : source;

  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
      {label}
    </span>
  );
}

// --------------------------------------------------------------------------- //
// Font preview card                                                             //
// --------------------------------------------------------------------------- //

function FontCard({ match, rank }: { match: FontMatch; rank: number }) {
  const pct = Math.round(match.score * 100);
  // Clamp to [0, 100] in case of floating-point overshoot
  const barPct = Math.min(100, Math.max(0, pct));

  // Build a Google Fonts CSS import URL for preview if the source is google.
  // For other sources we skip the live preview (no reliable CDN).
  const fontFamilyEncoded = encodeURIComponent(match.family);
  const previewStyle =
    match.source === "google"
      ? {
          fontFamily: `"${match.family}", sans-serif`,
        }
      : {};

  return (
    <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-[var(--color-muted)]">#{rank}</p>
          <p className="mt-0.5 text-lg font-semibold leading-tight">{match.family}</p>
          <p className="text-sm text-[var(--color-muted)]">{match.style}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <SourceBadge source={match.source} />
          {match.license && (
            <span className="text-[10px] text-[var(--color-muted)]">{match.license}</span>
          )}
        </div>
      </div>

      {/* Score bar */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>Match confidence</span>
          <span className="font-medium text-[var(--color-fg)]">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-all"
            style={{ width: `${barPct}%` }}
          />
        </div>
      </div>

      {/* Font preview (Google Fonts only via CSS API) */}
      {match.source === "google" && (
        <>
          {/* Inject the @import so the font loads */}
          {/* eslint-disable-next-line @next/next/no-page-custom-font */}
          <style>{`@import url('https://fonts.googleapis.com/css2?family=${fontFamilyEncoded}:ital,wght@0,400;0,700;1,400&display=swap');`}</style>
          <div
            className="mt-4 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-lg leading-snug"
            style={previewStyle}
            aria-label={`Preview of ${match.family}`}
          >
            The quick brown fox jumps over the lazy dog
          </div>
        </>
      )}

      {/* Download button */}
      {match.downloadUrl && (
        <a
          href={match.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Download
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </a>
      )}
    </article>
  );
}

// --------------------------------------------------------------------------- //
// Main UI                                                                       //
// --------------------------------------------------------------------------- //

export function FontIdentifyUI() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const identify = useCallback(async (file: File) => {
    if (!ACCEPTED.includes(file.type)) {
      toast.show("Unsupported file type. Use PNG, JPEG, or WebP.", { tone: "error" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.show("Image too large (max 10 MB).", { tone: "error" });
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    setState({ kind: "loading" });

    const body = new FormData();
    body.append("file", file);

    try {
      const r = await fetch("/api/font-clone/identify", {
        method: "POST",
        body,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const json = (await r.json()) as { matches: FontMatch[] };
      setState({ kind: "done", matches: json.matches ?? [], imageUrl });
    } catch (e) {
      URL.revokeObjectURL(imageUrl);
      const msg = e instanceof Error ? e.message : "Request failed";
      setState({ kind: "error", message: msg });
    }
  }, [toast]);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void identify(file);
      // Reset so the same file can be re-uploaded
      e.target.value = "";
    },
    [identify]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void identify(file);
    },
    [identify]
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setDragging(false), []);

  const isLoading = state.kind === "loading";

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload image"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-12 text-center transition ${
          dragging
            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
            : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/60"
        } ${isLoading ? "pointer-events-none opacity-60" : ""}`}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[var(--color-muted)]"
          aria-hidden="true"
        >
          <path d="M4 16l4-4 4 4 4-8 4 4" />
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
        <div>
          <p className="text-sm font-medium">
            {isLoading ? "Identifying font…" : "Drop an image here, or click to browse"}
          </p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            PNG, JPEG, WebP · max 10 MB
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onFileChange}
      />

      {/* Loading state */}
      {isLoading && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-sm text-[var(--color-muted)]">
            Analysing text region and matching against 5,000+ fonts…
          </p>
        </div>
      )}

      {/* Results */}
      {state.kind === "done" && (
        <div className="space-y-6">
          {/* User's uploaded image preview */}
          <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <p className="mb-3 text-xs text-[var(--color-muted)]">Your image</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={state.imageUrl}
              alt="Uploaded image"
              className="max-h-48 w-full rounded-md object-contain"
            />
          </div>

          {/* Match cards */}
          {state.matches.length === 0 ? (
            <p className="text-center text-sm text-[var(--color-muted)]">
              No matches found. The font index may be empty — check back soon.
            </p>
          ) : (
            <>
              <p className="text-xs text-[var(--color-muted)]">
                Top {state.matches.length} match{state.matches.length === 1 ? "" : "es"}
              </p>
              {state.matches.map((m, i) => (
                <FontCard key={`${m.family}-${m.style}-${i}`} match={m} rank={i + 1} />
              ))}
            </>
          )}

          {/* Try another */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setState({ kind: "idle" });
                inputRef.current?.click();
              }}
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:border-[var(--color-accent)]"
            >
              Try another image
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {state.kind === "error" && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">
          {state.message}
        </div>
      )}

      <Toast />
    </div>
  );
}

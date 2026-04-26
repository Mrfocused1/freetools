"use client";

import { useCallback, useEffect, useState } from "react";
import { Toast, useToast } from "./Toast";

type TraceEntry = { action: string; detail: string };
type State =
  | { kind: "idle" }
  | { kind: "asking"; query: string }
  | {
      kind: "done";
      query: string;
      answer: string;
      trace: TraceEntry[];
      iterations: number;
    }
  | { kind: "error"; message: string };

const LS_WEB_SEARCH = "quickfix:research:webSearch";

export function ResearchUI() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [query, setQuery] = useState("");
  const [webSearch, setWebSearch] = useState(true);
  const toast = useToast();

  // Load saved preference
  useEffect(() => {
    const saved = localStorage.getItem(LS_WEB_SEARCH);
    if (saved !== null) setWebSearch(saved === "true");
  }, []);

  const toggleWebSearch = useCallback(() => {
    setWebSearch((v) => {
      const next = !v;
      localStorage.setItem(LS_WEB_SEARCH, String(next));
      return next;
    });
  }, []);

  const onAsk = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setState({ kind: "asking", query: q });
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, webSearch }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const json = (await r.json()) as {
        answer: string;
        trace: TraceEntry[];
        iterations: number;
      };
      setState({ kind: "done", query: q, ...json });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setState({ kind: "error", message: msg });
    }
  }, [query, webSearch]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void onAsk();
      }
    },
    [onAsk]
  );

  const isAsking = state.kind === "asking";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            webSearch
              ? "Ask anything — we'll search the web and answer with citations."
              : "Chat directly with the model — no web search."
          }
          rows={3}
          className="w-full resize-none bg-transparent text-base outline-none"
          disabled={isAsking}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <button
              type="button"
              role="switch"
              aria-checked={webSearch}
              onClick={toggleWebSearch}
              disabled={isAsking}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                webSearch ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
              } disabled:opacity-50`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                  webSearch ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
            <span className="select-none">
              Web search {webSearch ? "on" : "off"}
            </span>
            <span className="opacity-60">·</span>
            <span>{query.length}/800 · ⌘+Enter</span>
          </div>
          <button
            onClick={onAsk}
            disabled={isAsking || !query.trim()}
            className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {isAsking ? "Working…" : "Ask"}
          </button>
        </div>
      </div>

      {state.kind === "asking" && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-sm text-[var(--color-muted)]">
            Searching the web and reading pages… (typically 10-60 seconds)
          </p>
          <p className="mt-3 line-clamp-2 text-sm">
            <span className="font-medium">Question:</span> {state.query}
          </p>
        </div>
      )}

      {state.kind === "done" && (
        <Result
          query={state.query}
          answer={state.answer}
          trace={state.trace}
          iterations={state.iterations}
        />
      )}

      {state.kind === "error" && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">
          {state.message}
        </div>
      )}

      <Toast />
    </div>
  );
}

function Result({
  query,
  answer,
  trace,
  iterations,
}: {
  query: string;
  answer: string;
  trace: TraceEntry[];
  iterations: number;
}) {
  const [showTrace, setShowTrace] = useState(false);
  return (
    <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <p className="text-xs text-[var(--color-muted)]">Question</p>
      <p className="mt-1 text-sm">{query}</p>

      <p className="mt-4 text-xs text-[var(--color-muted)]">Answer</p>
      <div className="mt-1 whitespace-pre-wrap text-base leading-relaxed">{answer}</div>

      <div className="mt-4 flex items-center justify-between text-xs text-[var(--color-muted)]">
        <span>
          {iterations} iteration{iterations === 1 ? "" : "s"} · {trace.length} tool call
          {trace.length === 1 ? "" : "s"}
        </span>
        <button
          onClick={() => setShowTrace((v) => !v)}
          className="underline hover:text-[var(--color-fg)]"
        >
          {showTrace ? "Hide trace" : "Show trace"}
        </button>
      </div>
      {showTrace && (
        <ol className="mt-3 space-y-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs">
          {trace.map((t, i) => (
            <li key={i} className="font-mono">
              <span className="font-medium text-[var(--color-fg)]">{t.action}</span>
              <span className="ml-2 text-[var(--color-muted)]">{t.detail}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

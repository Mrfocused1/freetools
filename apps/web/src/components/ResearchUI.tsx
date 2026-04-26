"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Toast, useToast } from "./Toast";

type GemmaConfig = { url: string; token: string };
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

const LS_KEY = "quickfix:gemma4-config";

function loadConfig(): GemmaConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.url && parsed?.token) return parsed as GemmaConfig;
  } catch {}
  return null;
}

function saveConfig(cfg: GemmaConfig) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}

function clearConfig() {
  localStorage.removeItem(LS_KEY);
}

export function ResearchUI() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [query, setQuery] = useState("");
  const [config, setConfig] = useState<GemmaConfig | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [model, setModel] = useState("google/gemma-4-E4B-it");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const toast = useToast();

  useEffect(() => {
    const cfg = loadConfig();
    if (cfg) setConfig(cfg);
    else setShowSettings(true);
  }, []);

  const onAsk = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    if (!config) {
      toast.show("Configure Gemma 4 endpoint first.");
      setShowSettings(true);
      return;
    }
    setState({ kind: "asking", query: q });
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, gemma: config, model }),
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
  }, [query, config, model, toast]);

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
      {/* Settings: Gemma endpoint */}
      <ConfigPanel
        config={config}
        open={showSettings}
        onSave={(cfg) => {
          saveConfig(cfg);
          setConfig(cfg);
          setShowSettings(false);
          toast.show("Gemma endpoint saved.");
        }}
        onClear={() => {
          clearConfig();
          setConfig(null);
          setShowSettings(true);
          toast.show("Cleared.");
        }}
        onClose={() => setShowSettings(false)}
        model={model}
        onModelChange={setModel}
      />

      {!showSettings && (
        <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>
            Connected to{" "}
            <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-mono">
              {config?.url ?? "(not set)"}
            </code>{" "}
            · model{" "}
            <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-mono">
              {model}
            </code>
          </span>
          <button
            onClick={() => setShowSettings(true)}
            className="underline hover:text-[var(--color-fg)]"
          >
            Change
          </button>
        </div>
      )}

      {/* Question input */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <textarea
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask anything — Gemma 4 will search the web and answer with citations."
          rows={3}
          className="w-full resize-none bg-transparent text-base outline-none"
          disabled={isAsking}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-[var(--color-muted)]">
            {query.length}/800 chars · ⌘/Ctrl + Enter to send
          </span>
          <button
            onClick={onAsk}
            disabled={isAsking || !query.trim() || !config}
            className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {isAsking ? "Researching…" : "Ask"}
          </button>
        </div>
      </div>

      {/* Result */}
      {state.kind === "asking" && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-sm text-[var(--color-muted)]">
            Gemma is thinking, searching, and reading… (typically 10-60 seconds)
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

function ConfigPanel({
  config,
  open,
  onSave,
  onClear,
  onClose,
  model,
  onModelChange,
}: {
  config: GemmaConfig | null;
  open: boolean;
  onSave: (cfg: GemmaConfig) => void;
  onClear: () => void;
  onClose: () => void;
  model: string;
  onModelChange: (m: string) => void;
}) {
  const [url, setUrl] = useState(config?.url ?? "");
  const [token, setToken] = useState(config?.token ?? "");
  const [pasteText, setPasteText] = useState("");

  useEffect(() => {
    setUrl(config?.url ?? "");
    setToken(config?.token ?? "");
  }, [config]);

  const tryParse = useCallback(() => {
    if (!pasteText.trim()) return;
    try {
      const parsed = JSON.parse(pasteText);
      if (parsed?.url) setUrl(parsed.url);
      if (parsed?.token) setToken(parsed.token);
      if (parsed?.model) onModelChange(parsed.model);
      setPasteText("");
    } catch {}
  }, [pasteText, onModelChange]);

  if (!open) return null;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-medium">Gemma 4 endpoint</h2>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            On your Mac:{" "}
            <code className="rounded bg-[var(--color-bg)] px-1 py-0.5 font-mono">
              bash tools/gemma4/scripts/gemma4-up.sh
            </code>{" "}
            then paste the JSON output below.
          </p>
        </div>
        {config && (
          <button
            onClick={onClose}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            Close
          </button>
        )}
      </div>

      <textarea
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        onBlur={tryParse}
        placeholder='Paste the entire JSON: {"id": ..., "token": "...", "url": "http://...", "model": "..."}'
        rows={3}
        className="mt-3 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-xs outline-none focus:border-[var(--color-accent)]"
      />

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        <label className="text-xs">
          <span className="text-[var(--color-muted)]">URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://1.2.3.4:8000"
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 font-mono outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <label className="text-xs">
          <span className="text-[var(--color-muted)]">Token</span>
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="api token"
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 font-mono outline-none focus:border-[var(--color-accent)]"
          />
        </label>
      </div>

      <div className="mt-3">
        <label className="text-xs">
          <span className="text-[var(--color-muted)]">Model</span>
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 outline-none focus:border-[var(--color-accent)]"
          >
            <option value="google/gemma-4-E2B-it">E2B — fastest, smallest</option>
            <option value="google/gemma-4-E4B-it">E4B — balanced (default)</option>
            <option value="google/gemma-4-26B-A4B-it">26B-A4B — higher quality</option>
            <option value="google/gemma-4-31B-it">31B — best, requires H100</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => onSave({ url, token })}
          disabled={!url || !token}
          className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
        {config && (
          <button
            onClick={onClear}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:border-red-500"
          >
            Clear
          </button>
        )}
      </div>
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

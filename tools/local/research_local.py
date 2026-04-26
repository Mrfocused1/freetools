"""Local research tool — single-file FastAPI server.

Runs on your Mac. Combines:
  - public Searxng instance (no signup) for search
  - simple HTTP fetch + HTML-to-text for page reading
  - OpenRouter free Qwen 3 Next 80B Instruct for the agent loop
  - tiny embedded HTML UI

Run:
  OPENROUTER_API_KEY=sk-or-... python3 tools/local/research_local.py
  open http://localhost:7777
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from typing import Any

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "openai/gpt-oss-120b:free")
PORT = int(os.environ.get("PORT", "7777"))

SEARXNG_INSTANCES = [
    "https://searx.be",
    "https://search.tiekoetter.com",
    "https://baresearch.org",
    "https://priv.au",
    "https://search.bus-hit.me",
    "https://searx.work",
    "https://searx.tuxcloud.net",
    "https://searx.lunar.icu",
    "https://search.inetol.net",
    "https://opnxng.com",
]

DEFAULT_MAX_ITERATIONS = 8
MAX_FETCH_CHARS = 5000
MAX_SEARCH_RESULTS = 6
MAX_CONTEXT_MESSAGES = 18  # cap to avoid blowing the context window on long pages

# Qwen 3 system prompt:
# - /no_think tag forces non-thinking mode (faster, cleaner JSON output)
# - explicit JSON-only contract
# - skip-search rule for trivial questions
SYSTEM_PROMPT = """You are a research agent. /no_think

For trivial questions (greetings, math, common knowledge that needs no
verification), respond IMMEDIATELY with the answer tool — never search.

Use search/fetch ONLY when the answer needs current or specialized web info.

You have exactly three tools — call ONE per turn:
  search(query: str) — web search; returns list of {title, url, snippet}.
  fetch(url: str)    — load a URL as readable text.
  answer(text: str)  — your final answer (with [1], [2] citations if you fetched sources).

Output format: a single JSON object on each turn. No prose, no markdown fences.
Examples:
  {"tool": "search", "query": "openrouter free tier limits 2026"}
  {"tool": "fetch", "url": "https://openrouter.ai/docs"}
  {"tool": "answer", "text": "OpenRouter's free tier allows 50 requests per day [1]."}

For research questions: 1-3 searches → fetch 2-4 useful URLs → answer.
Stop as soon as you have enough information. Be concise."""

app = FastAPI(title="Local Research")


class AskBody(BaseModel):
    query: str
    maxIterations: int = DEFAULT_MAX_ITERATIONS


# ---- Tool implementations ----------------------------------------------

async def _search_searxng(client: httpx.AsyncClient, query: str) -> list[dict[str, str]]:
    last_err: Exception | None = None
    for base in SEARXNG_INSTANCES:
        try:
            r = await client.get(
                f"{base}/search",
                params={"q": query, "format": "json", "safesearch": 0, "language": "en"},
                timeout=10.0,
                headers={"User-Agent": "Mozilla/5.0 QuickFix-Research/1.0"},
            )
            r.raise_for_status()
            data = r.json()
            hits = []
            for item in data.get("results", [])[:MAX_SEARCH_RESULTS]:
                url = (item.get("url") or "").strip()
                if not url:
                    continue
                hits.append({
                    "title": (item.get("title") or "").strip()[:200],
                    "url": url,
                    "snippet": (item.get("content") or "").strip()[:300],
                })
            if hits:
                return hits
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"searxng exhausted: {last_err}")


async def _search_ddg(client: httpx.AsyncClient, query: str) -> list[dict[str, str]]:
    """DuckDuckGo HTML fallback — no API key, scrapes the lite endpoint."""
    r = await client.get(
        "https://html.duckduckgo.com/html/",
        params={"q": query},
        timeout=15.0,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
    )
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    hits: list[dict[str, str]] = []
    for result in soup.select(".result")[:MAX_SEARCH_RESULTS]:
        a = result.select_one("a.result__a")
        snippet_el = result.select_one(".result__snippet")
        if not a:
            continue
        url = a.get("href", "")
        # DDG wraps URLs through a redirector — strip it.
        m = re.search(r"uddg=([^&]+)", url)
        if m:
            from urllib.parse import unquote
            url = unquote(m.group(1))
        if not url.startswith(("http://", "https://")):
            continue
        hits.append({
            "title": a.get_text(strip=True)[:200],
            "url": url,
            "snippet": (snippet_el.get_text(strip=True) if snippet_el else "")[:300],
        })
    return hits


async def search(client: httpx.AsyncClient, query: str) -> list[dict[str, str]]:
    """Try Searxng first; fall back to DuckDuckGo HTML if all instances fail."""
    try:
        return await _search_searxng(client, query)
    except Exception:
        pass
    try:
        hits = await _search_ddg(client, query)
        if hits:
            return hits
    except Exception as e:
        raise RuntimeError(f"both searxng and DDG failed: {e}")
    raise RuntimeError("all search backends returned no results")


async def fetch(client: httpx.AsyncClient, url: str) -> str:
    r = await client.get(
        url,
        timeout=20.0,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; QuickFix-Research/1.0)"},
    )
    r.raise_for_status()
    ctype = r.headers.get("content-type", "").lower()
    if "html" not in ctype and "xml" not in ctype:
        # Plain text or other — return as-is, truncated.
        text = r.text
    else:
        soup = BeautifulSoup(r.text, "lxml")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "noscript"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    if len(text) > MAX_FETCH_CHARS:
        text = text[:MAX_FETCH_CHARS] + "\n\n…(truncated)"
    return text


# ---- LLM call with retry ----------------------------------------------

async def llm_chat(client: httpx.AsyncClient, messages: list[dict]) -> str:
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY env var not set")

    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        # Lower temperature for cleaner JSON tool-call output.
        "temperature": 0.3,
        "top_p": 0.9,
        "max_tokens": 1024,
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "content-type": "application/json",
        "HTTP-Referer": "http://localhost:7777",
        "X-Title": "Quick Fix Local Research",
    }

    delays = [3, 6, 12, 24]  # exponential backoff for 429s; ~45s total worst case
    last_err: Exception | None = None
    for attempt in range(len(delays) + 1):
        try:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=120.0,
            )
            if r.status_code == 429 and attempt < len(delays):
                # Honor Retry-After if present, else use our backoff.
                ra = r.headers.get("retry-after")
                wait = int(ra) if (ra and ra.isdigit()) else delays[attempt]
                await asyncio.sleep(wait)
                last_err = RuntimeError(f"429 (retrying in {wait}s)")
                continue
            r.raise_for_status()
            data = r.json()
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError(f"empty choices in response: {data}")
            msg = choices[0].get("message", {})
            content = msg.get("content")
            if not content:
                raise RuntimeError(f"empty content in response: {msg}")
            return content
        except httpx.HTTPStatusError as e:
            last_err = e
            if attempt < len(delays) and e.response.status_code in (429, 502, 503, 504):
                await asyncio.sleep(delays[attempt])
                continue
            raise
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            last_err = e
            if attempt < len(delays):
                await asyncio.sleep(delays[attempt])
                continue
            raise
    raise last_err or RuntimeError("LLM unreachable after retries")


# ---- Tool-call parsing -------------------------------------------------

def parse_tool_call(text: str) -> dict[str, Any] | None:
    """Extract the first JSON tool-call object from the model's reply.

    Robust to: markdown code fences, leading/trailing prose, multiple objects
    (returns the first), thinking-tag noise from Qwen.
    """
    if not text:
        return None
    t = text.strip()

    # Strip Qwen's thinking tags if they leaked through.
    t = re.sub(r"<think>[\s\S]*?</think>", "", t).strip()

    # Strip code fences.
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```\s*$", "", t)

    # Try a direct parse first.
    try:
        obj = json.loads(t)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass

    # Fall back: scan for a balanced { ... } block.
    depth = 0
    start = -1
    for i, ch in enumerate(t):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start != -1:
                blob = t[start:i + 1]
                try:
                    obj = json.loads(blob)
                    if isinstance(obj, dict):
                        return obj
                except json.JSONDecodeError:
                    start = -1
                    continue
    return None


def trim_messages(messages: list[dict], cap: int = MAX_CONTEXT_MESSAGES) -> list[dict]:
    """Keep system + most recent (cap-1) entries to bound context size."""
    if len(messages) <= cap:
        return messages
    system = [m for m in messages if m.get("role") == "system"][:1]
    rest = [m for m in messages if m.get("role") != "system"]
    return system + rest[-(cap - len(system)):]


# ---- Agent loop endpoint ----------------------------------------------

@app.post("/ask")
async def ask(body: AskBody) -> dict[str, Any]:
    trace: list[dict[str, str]] = []
    messages: list[dict[str, str]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": body.query.strip()},
    ]

    async with httpx.AsyncClient() as client:
        for i in range(1, body.maxIterations + 1):
            try:
                reply = await llm_chat(client, trim_messages(messages))
            except Exception as e:
                detail = str(e)
                # Friendlier message when free tier is saturated.
                if "429" in detail:
                    detail = (
                        "OpenRouter free tier rate limit hit even after retries. "
                        "Try again in a minute, or add credit at https://openrouter.ai/credits."
                    )
                raise HTTPException(status_code=502, detail=f"LLM error: {detail}")

            call = parse_tool_call(reply)
            if not call or not isinstance(call.get("tool"), str):
                # Treat the raw reply as the answer.
                trace.append({"action": "answer", "detail": "(no tool call detected)"})
                return {"answer": reply.strip(), "trace": trace, "iterations": i}

            tool = call["tool"].lower()

            if tool == "answer":
                text = (call.get("text") or "").strip()
                if not text:
                    text = reply.strip()
                trace.append({"action": "answer", "detail": f"len={len(text)}"})
                return {"answer": text, "trace": trace, "iterations": i}

            if tool == "search":
                q = (call.get("query") or "").strip()
                trace.append({"action": "search", "detail": q[:160]})
                messages.append({"role": "assistant", "content": reply})
                if not q:
                    messages.append({"role": "user", "content": "Empty query. Provide a non-empty search string."})
                    continue
                try:
                    hits = await search(client, q)
                    messages.append({
                        "role": "user",
                        "content": f"search results for {q!r}:\n{json.dumps(hits, ensure_ascii=False, indent=2)}",
                    })
                except Exception as e:
                    trace.append({"action": "search.error", "detail": str(e)[:160]})
                    messages.append({
                        "role": "user",
                        "content": f"Search failed: {e}. Try a different query, or answer from what you know.",
                    })
                continue

            if tool == "fetch":
                url = (call.get("url") or "").strip()
                trace.append({"action": "fetch", "detail": url[:200]})
                messages.append({"role": "assistant", "content": reply})
                if not url.startswith(("http://", "https://")):
                    messages.append({"role": "user", "content": "Invalid URL — must start with http:// or https://."})
                    continue
                try:
                    md = await fetch(client, url)
                    messages.append({
                        "role": "user",
                        "content": f"Content of {url}:\n\n{md}",
                    })
                except Exception as e:
                    trace.append({"action": "fetch.error", "detail": str(e)[:160]})
                    messages.append({
                        "role": "user",
                        "content": f"Fetch failed for {url}: {e}. Try a different URL or answer with what you have.",
                    })
                continue

            # Unknown tool — nudge with reminder.
            trace.append({"action": "unknown_tool", "detail": str(tool)[:60]})
            messages.append({"role": "assistant", "content": reply})
            messages.append({
                "role": "user",
                "content": "Unknown tool. Use exactly one of: search, fetch, answer.",
            })

        trace.append({"action": "iteration_cap", "detail": str(body.maxIterations)})
        return {
            "answer": "(reached the iteration cap without a final answer — try a more specific question)",
            "trace": trace,
            "iterations": body.maxIterations,
        }


# ---- Embedded HTML UI -------------------------------------------------

INDEX_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>Local Research — Qwen 3</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #111; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 14px; margin: 0 0 24px; }
  textarea { width: 100%; padding: 12px; font: inherit; border: 1px solid #ccc; border-radius: 8px; resize: vertical; box-sizing: border-box; }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .grow { flex: 1; }
  button { padding: 8px 16px; font: inherit; background: #7c5cff; color: white; border: 0; border-radius: 6px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .small { font-size: 12px; color: #666; }
  .card { margin-top: 24px; padding: 16px; border: 1px solid #eee; border-radius: 8px; background: #fafafa; }
  .label { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: .04em; margin: 0 0 4px; }
  .answer { white-space: pre-wrap; line-height: 1.55; }
  details { margin-top: 12px; }
  ol.trace { font-family: ui-monospace, monospace; font-size: 12px; padding: 12px; background: #f0f0f0; border-radius: 6px; }
  ol.trace li { margin: 2px 0; }
  .err { background: #fee; border-color: #fcc; color: #b00; }
  .spin { display:inline-block;width:14px;height:14px;border:2px solid #ccc;border-top-color:#7c5cff;border-radius:50%;animation:s 1s linear infinite;vertical-align:middle;margin-right:6px}
  @keyframes s{to{transform:rotate(360deg)}}
</style></head>
<body>
  <h1>AI Research</h1>
  <p class="sub">Qwen 3 80B + web browsing. Free, runs on your Mac.</p>
  <textarea id="q" rows="3" placeholder="Ask anything…"></textarea>
  <div class="row">
    <span class="small grow"><span id="charcount">0</span> chars · ⌘+Enter to send</span>
    <button id="ask">Ask</button>
  </div>
  <div id="out"></div>
<script>
const q = document.getElementById('q'), btn = document.getElementById('ask'), out = document.getElementById('out'), cc = document.getElementById('charcount');
q.addEventListener('input', () => cc.textContent = q.value.length);
q.addEventListener('keydown', e => { if ((e.metaKey||e.ctrlKey) && e.key==='Enter') ask(); });
btn.addEventListener('click', ask);
async function ask() {
  const query = q.value.trim();
  if (!query) return;
  btn.disabled = true; btn.textContent = 'Researching…';
  out.innerHTML = '<div class="card"><span class="spin"></span>Thinking, searching, reading…</div>';
  try {
    const r = await fetch('/ask', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({query}) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || j.error || ('HTTP ' + r.status));
    out.innerHTML = render(query, j);
  } catch (e) {
    out.innerHTML = `<div class="card err">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Ask';
  }
}
function esc(s){return (s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));}
function render(query, j){
  const trace = (j.trace||[]).map(t => `<li><b>${esc(t.action)}</b> <span class="small">${esc(t.detail)}</span></li>`).join('');
  return `
    <div class="card">
      <p class="label">Question</p>
      <div>${esc(query)}</div>
      <p class="label" style="margin-top:16px">Answer</p>
      <div class="answer">${esc(j.answer||'')}</div>
      <details><summary class="small">${j.iterations||0} iteration${j.iterations===1?'':'s'} · ${(j.trace||[]).length} steps · view trace</summary>
        <ol class="trace">${trace}</ol>
      </details>
    </div>`;
}
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
    return INDEX_HTML


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "model": LLM_MODEL, "have_key": bool(OPENROUTER_API_KEY)}


if __name__ == "__main__":
    if not OPENROUTER_API_KEY:
        print("ERROR: set OPENROUTER_API_KEY env var", file=sys.stderr)
        sys.exit(1)
    import uvicorn
    print(f"\n  → open http://localhost:{PORT}\n")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")

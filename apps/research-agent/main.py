"""Research agent — gives Gemma 4 the ability to browse the web.

Runs in the Hetzner docker stack. Receives a query + a vast.ai Gemma 4
endpoint, then iterates: model proposes a tool call → we execute against
Searxng (search) or Crawl4AI (fetch) → result is fed back → repeat
until the model produces an answer or hits the iteration cap.

POST /api/research
  Authorization: Bearer <RESEARCH_TOKEN>
  body: {
    "query": "...",
    "gemma": {"url": "http://1.2.3.4:8000", "token": "..."},
    "model": "google/gemma-4-E4B-it",          # optional override
    "maxIterations": 8,                        # optional cap (default 8)
    "maxFetchChars": 6000                      # cap context size per fetch
  }
  → { "answer": "...", "trace": [{"action":"search","query":"..."}, ...] }
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

import httpx
from crawl4ai import AsyncWebCrawler
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, HttpUrl

RESEARCH_TOKEN = os.environ["RESEARCH_TOKEN"]
SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://searxng:8888")

# Default upstream LLM (OpenRouter free Gemma 4). Overridable per request.
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "google/gemma-3-27b-it:free")

DEFAULT_MAX_ITERATIONS = 8
DEFAULT_MAX_FETCH_CHARS = 6000
DEFAULT_MAX_SEARCH_RESULTS = 6

SYSTEM_PROMPT = """You are a research agent.

If the question is trivial (greetings, math, common knowledge that doesn't need
verification), answer immediately with the answer tool — do NOT search.
Use search/fetch only when the answer genuinely requires up-to-date or
specialized web information.

Available tools (you may call ONE per turn):

- search(query: str) — search the web; returns a list of {title, url, snippet}.
- fetch(url: str) — fetch the content of a URL as readable markdown.
- answer(text: str) — your final answer; include inline citations like [1], [2]
  when you used fetched sources.

You MUST respond with a single JSON object on each turn, no prose, in this shape:
{"tool": "search", "query": "..."}
{"tool": "fetch", "url": "https://..."}
{"tool": "answer", "text": "..."}

For research questions: 1-3 searches → fetch 2-4 useful URLs → answer.
Be concise. Don't over-search. Stop as soon as you have enough to answer.
"""


class GemmaConfig(BaseModel):
    url: str  # e.g. http://1.2.3.4:8000
    token: str


class ResearchRequest(BaseModel):
    query: str
    # Optional per-request LLM override (admin/CLI use). If absent, falls back
    # to the server-configured LLM_* env vars (default: OpenRouter free Gemma).
    gemma: GemmaConfig | None = None
    model: str | None = None
    maxIterations: int = DEFAULT_MAX_ITERATIONS
    maxFetchChars: int = DEFAULT_MAX_FETCH_CHARS


class TraceEntry(BaseModel):
    action: str
    detail: str


class ResearchResponse(BaseModel):
    answer: str
    trace: list[TraceEntry]
    iterations: int


app = FastAPI()


def _check_auth(authorization: str | None) -> None:
    if not authorization or authorization != f"Bearer {RESEARCH_TOKEN}":
        raise HTTPException(status_code=401, detail="invalid token")


# ---- Tool implementations ----------------------------------------------

async def tool_search(client: httpx.AsyncClient, query: str) -> list[dict[str, str]]:
    r = await client.get(
        f"{SEARXNG_URL}/search",
        params={"q": query, "format": "json", "safesearch": 0, "language": "en"},
        timeout=20.0,
    )
    r.raise_for_status()
    data = r.json()
    hits = []
    for item in data.get("results", [])[:DEFAULT_MAX_SEARCH_RESULTS]:
        hits.append({
            "title": item.get("title", "")[:200],
            "url": item.get("url", ""),
            "snippet": (item.get("content") or "")[:300],
        })
    return hits


async def tool_fetch(url: str, max_chars: int) -> str:
    async with AsyncWebCrawler(headless=True, verbose=False) as crawler:
        result = await crawler.arun(url=url, bypass_cache=True)
        if not result.success:
            return f"(fetch failed: {result.error_message or 'unknown'})"
        md = result.markdown or ""
        if len(md) > max_chars:
            md = md[:max_chars] + "\n\n…(truncated)"
        return md


# ---- Gemma 4 chat completion (OpenAI-compatible via vLLM) --------------

async def llm_chat(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "content-type": "application/json",
    }
    # OpenRouter recommends these headers for analytics/ranking; harmless elsewhere.
    if "openrouter" in base_url:
        headers["HTTP-Referer"] = os.environ.get("APP_URL", "https://coachpixel.com")
        headers["X-Title"] = "Quick Fix Research"

    # Free Gemma on OpenRouter is routed through Google AI Studio which has
    # tight per-minute caps (~10 RPM). The agent loop bursts several calls
    # per question, so we retry on 429 with exponential backoff
    # (honoring Retry-After when present).
    delays = [3, 8, 15, 30]  # seconds; ~56s total worst case
    last_err: Exception | None = None
    for attempt, delay in enumerate([0] + delays):
        if delay:
            await asyncio.sleep(delay)
        try:
            r = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": 0.2,
                    "max_tokens": 1024,
                },
                timeout=120.0,
            )
            if r.status_code == 429 and attempt < len(delays):
                ra = r.headers.get("retry-after")
                if ra and ra.isdigit():
                    delays[attempt] = max(int(ra), delays[attempt])
                last_err = httpx.HTTPStatusError("429", request=r.request, response=r)
                continue
            r.raise_for_status()
            data = r.json()
            return data["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            last_err = e
            if e.response.status_code != 429 or attempt >= len(delays):
                raise
    raise last_err or RuntimeError("LLM unreachable after retries")


# ---- Tool-call parsing -------------------------------------------------

_JSON_BLOCK = re.compile(r"\{[\s\S]*\}")


def parse_tool_call(text: str) -> dict[str, Any] | None:
    """Extract the first JSON object the model emitted."""
    text = text.strip()
    # Strip ```json fences if present
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    m = _JSON_BLOCK.search(text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


# ---- Agent loop --------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "searxng": SEARXNG_URL, "default_model": LLM_MODEL}


@app.post("/api/research", response_model=ResearchResponse)
async def research(
    req: ResearchRequest,
    authorization: str | None = Header(None),
) -> ResearchResponse:
    _check_auth(authorization)

    # Resolve the upstream LLM: per-request override → env defaults.
    if req.gemma is not None:
        base_url = req.gemma.url.rstrip("/")
        # If the caller didn't include /v1, assume vLLM-style and append it.
        if not base_url.endswith("/v1"):
            base_url = base_url + "/v1"
        api_key = req.gemma.token
        model = req.model or LLM_MODEL
    else:
        if not LLM_API_KEY:
            raise HTTPException(
                status_code=503,
                detail="No LLM configured. Set LLM_API_KEY env var or pass gemma in request.",
            )
        base_url = LLM_BASE_URL
        api_key = LLM_API_KEY
        model = req.model or LLM_MODEL

    trace: list[TraceEntry] = []
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": req.query},
    ]

    async with httpx.AsyncClient() as client:
        for iteration in range(1, req.maxIterations + 1):
            try:
                reply = await llm_chat(client, base_url, api_key, model, messages)
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")

            call = parse_tool_call(reply)
            if not call or "tool" not in call:
                # Model didn't follow the protocol — treat the raw reply as the answer.
                trace.append(TraceEntry(action="answer", detail="(parser fallback)"))
                return ResearchResponse(answer=reply.strip(), trace=trace, iterations=iteration)

            tool = call["tool"]
            if tool == "answer":
                text = call.get("text", "").strip() or reply.strip()
                trace.append(TraceEntry(action="answer", detail=f"len={len(text)}"))
                return ResearchResponse(answer=text, trace=trace, iterations=iteration)

            if tool == "search":
                q = call.get("query", "").strip()
                trace.append(TraceEntry(action="search", detail=q[:160]))
                if not q:
                    messages.append({"role": "assistant", "content": reply})
                    messages.append({"role": "user", "content": "(empty query — try again)"})
                    continue
                try:
                    hits = await tool_search(client, q)
                except Exception as e:
                    hits = []
                    trace.append(TraceEntry(action="search.error", detail=str(e)[:160]))
                messages.append({"role": "assistant", "content": reply})
                messages.append({
                    "role": "user",
                    "content": f"search results for {q!r}:\n{json.dumps(hits, ensure_ascii=False)}",
                })
                continue

            if tool == "fetch":
                url = call.get("url", "").strip()
                trace.append(TraceEntry(action="fetch", detail=url[:200]))
                if not url:
                    messages.append({"role": "assistant", "content": reply})
                    messages.append({"role": "user", "content": "(empty url — try again)"})
                    continue
                try:
                    md = await tool_fetch(url, req.maxFetchChars)
                except Exception as e:
                    md = f"(fetch error: {e})"
                    trace.append(TraceEntry(action="fetch.error", detail=str(e)[:160]))
                messages.append({"role": "assistant", "content": reply})
                messages.append({
                    "role": "user",
                    "content": f"fetched {url}:\n\n{md}",
                })
                continue

            # Unknown tool — nudge the model.
            trace.append(TraceEntry(action="unknown_tool", detail=str(tool)[:60]))
            messages.append({"role": "assistant", "content": reply})
            messages.append({
                "role": "user",
                "content": "Unknown tool. Use search, fetch, or answer.",
            })

    # Hit the iteration cap without an answer.
    trace.append(TraceEntry(action="iteration_cap", detail=str(req.maxIterations)))
    return ResearchResponse(
        answer="(iteration cap reached without producing a final answer)",
        trace=trace,
        iterations=req.maxIterations,
    )

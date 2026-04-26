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

DEFAULT_MAX_ITERATIONS = 8
DEFAULT_MAX_FETCH_CHARS = 6000
DEFAULT_MAX_SEARCH_RESULTS = 6

SYSTEM_PROMPT = """You are a research agent. You answer the user's question by
iteratively using tools, then producing a final answer with citations.

Available tools (you may call ONE per turn):

- search(query: str) — search the web; returns a list of {title, url, snippet}.
- fetch(url: str) — fetch the content of a URL as readable markdown.
- answer(text: str) — your final answer, with inline citations like [1], [2]
  matching the URLs you fetched.

You MUST respond with a single JSON object on each turn, no prose, in this shape:
{"tool": "search", "query": "..."}
{"tool": "fetch", "url": "https://..."}
{"tool": "answer", "text": "..."}

Plan first: do 1-3 searches to find relevant URLs, then fetch the most useful
2-4 URLs, then answer. If a fetch returns nothing useful, try a different URL
or search. Be concise. Stop as soon as you have enough to answer.
"""


class GemmaConfig(BaseModel):
    url: str  # e.g. http://1.2.3.4:8000
    token: str


class ResearchRequest(BaseModel):
    query: str
    gemma: GemmaConfig
    model: str = "google/gemma-4-E4B-it"
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

async def gemma_chat(
    client: httpx.AsyncClient,
    cfg: GemmaConfig,
    model: str,
    messages: list[dict[str, str]],
) -> str:
    r = await client.post(
        f"{cfg.url}/v1/chat/completions",
        headers={"Authorization": f"Bearer {cfg.token}", "content-type": "application/json"},
        json={
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 1024,
        },
        timeout=120.0,
    )
    r.raise_for_status()
    data = r.json()
    return data["choices"][0]["message"]["content"]


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
    return {"ok": True, "searxng": SEARXNG_URL}


@app.post("/api/research", response_model=ResearchResponse)
async def research(
    req: ResearchRequest,
    authorization: str | None = Header(None),
) -> ResearchResponse:
    _check_auth(authorization)

    trace: list[TraceEntry] = []
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": req.query},
    ]

    async with httpx.AsyncClient() as client:
        for iteration in range(1, req.maxIterations + 1):
            try:
                reply = await gemma_chat(client, req.gemma, req.model, messages)
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"Gemma call failed: {e}")

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

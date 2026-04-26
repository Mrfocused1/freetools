"""Research agent — gives an LLM the ability to browse the web.

Runs in the Hetzner docker stack. Receives a query, then iterates: model
proposes a tool call (search/fetch/answer) → we execute against Searxng
or Crawl4AI → result is fed back → repeat until answer or iteration cap.

POST /api/research
  Authorization: Bearer <RESEARCH_TOKEN>
  body: {
    "query": "...",
    "gemma": {"url": "...", "token": "..."},  # optional admin override
    "model": "...",                            # optional override
    "maxIterations": 8,                        # optional cap (default 8)
    "maxFetchChars": 5000                      # cap context size per fetch
  }
  → { "answer": "...", "trace": [...], "iterations": N }
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
from pydantic import BaseModel

RESEARCH_TOKEN = os.environ["RESEARCH_TOKEN"]
SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://searxng:8888")

# Default upstream LLM (OpenRouter free Qwen 3 80B Instruct). Overridable per request.
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "openai/gpt-oss-120b:free")

DEFAULT_MAX_ITERATIONS = 8
DEFAULT_MAX_FETCH_CHARS = 5000
DEFAULT_MAX_SEARCH_RESULTS = 6
MAX_CONTEXT_MESSAGES = 18  # cap to keep within model context window

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


class GemmaConfig(BaseModel):
    url: str
    token: str


class ResearchRequest(BaseModel):
    query: str
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
        url = (item.get("url") or "").strip()
        if not url:
            continue
        hits.append({
            "title": (item.get("title") or "").strip()[:200],
            "url": url,
            "snippet": (item.get("content") or "").strip()[:300],
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


# ---- LLM chat with retry ----------------------------------------------

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
    if "openrouter" in base_url:
        headers["HTTP-Referer"] = os.environ.get("APP_URL", "https://coachpixel.com")
        headers["X-Title"] = "Quick Fix Research"

    # Low temperature → cleaner JSON tool-call output.
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.3,
        "top_p": 0.9,
        "max_tokens": 1024,
    }

    delays = [3, 6, 12, 24]  # backoff on 429/5xx; ~45s total worst case
    last_err: Exception | None = None
    for attempt in range(len(delays) + 1):
        try:
            r = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json=payload,
                timeout=120.0,
            )
            if r.status_code == 429 and attempt < len(delays):
                ra = r.headers.get("retry-after")
                wait = int(ra) if (ra and ra.isdigit()) else delays[attempt]
                await asyncio.sleep(wait)
                last_err = RuntimeError(f"429 (retrying in {wait}s)")
                continue
            r.raise_for_status()
            data = r.json()
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError(f"empty choices: {data}")
            msg = choices[0].get("message", {})
            content = msg.get("content")
            if not content:
                raise RuntimeError(f"empty content: {msg}")
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
    """Robustly extract the first JSON tool-call object from a model reply."""
    if not text:
        return None
    t = text.strip()

    # Strip Qwen's thinking tags if any leaked through.
    t = re.sub(r"<think>[\s\S]*?</think>", "", t).strip()

    # Strip code fences.
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```\s*$", "", t)

    # Try direct parse.
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


def trim_messages(messages: list[dict[str, str]], cap: int = MAX_CONTEXT_MESSAGES) -> list[dict[str, str]]:
    if len(messages) <= cap:
        return messages
    system = [m for m in messages if m.get("role") == "system"][:1]
    rest = [m for m in messages if m.get("role") != "system"]
    return system + rest[-(cap - len(system)):]


# ---- Endpoints --------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "searxng": SEARXNG_URL, "default_model": LLM_MODEL}


@app.post("/api/research", response_model=ResearchResponse)
async def research(
    req: ResearchRequest,
    authorization: str | None = Header(None),
) -> ResearchResponse:
    _check_auth(authorization)

    # Resolve upstream LLM: per-request override → env defaults.
    if req.gemma is not None:
        base_url = req.gemma.url.rstrip("/")
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
    messages: list[dict[str, str]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": req.query.strip()},
    ]

    async with httpx.AsyncClient() as client:
        for iteration in range(1, req.maxIterations + 1):
            try:
                reply = await llm_chat(client, base_url, api_key, model, trim_messages(messages))
            except Exception as e:
                detail = str(e)
                if "429" in detail:
                    detail = (
                        "Upstream LLM rate limit hit even after retries. "
                        "Try again shortly, or upgrade the OpenRouter tier."
                    )
                raise HTTPException(status_code=502, detail=f"LLM error: {detail}")

            call = parse_tool_call(reply)
            if not call or not isinstance(call.get("tool"), str):
                trace.append(TraceEntry(action="answer", detail="(no tool call detected)"))
                return ResearchResponse(answer=reply.strip(), trace=trace, iterations=iteration)

            tool = call["tool"].lower()

            if tool == "answer":
                text = (call.get("text") or "").strip() or reply.strip()
                trace.append(TraceEntry(action="answer", detail=f"len={len(text)}"))
                return ResearchResponse(answer=text, trace=trace, iterations=iteration)

            if tool == "search":
                q = (call.get("query") or "").strip()
                trace.append(TraceEntry(action="search", detail=q[:160]))
                messages.append({"role": "assistant", "content": reply})
                if not q:
                    messages.append({"role": "user", "content": "Empty query. Provide a non-empty search string."})
                    continue
                try:
                    hits = await tool_search(client, q)
                    messages.append({
                        "role": "user",
                        "content": f"search results for {q!r}:\n{json.dumps(hits, ensure_ascii=False, indent=2)}",
                    })
                except Exception as e:
                    trace.append(TraceEntry(action="search.error", detail=str(e)[:160]))
                    messages.append({
                        "role": "user",
                        "content": f"Search failed: {e}. Try a different query, or answer from what you know.",
                    })
                continue

            if tool == "fetch":
                url = (call.get("url") or "").strip()
                trace.append(TraceEntry(action="fetch", detail=url[:200]))
                messages.append({"role": "assistant", "content": reply})
                if not url.startswith(("http://", "https://")):
                    messages.append({"role": "user", "content": "Invalid URL — must start with http:// or https://."})
                    continue
                try:
                    md = await tool_fetch(url, req.maxFetchChars)
                    messages.append({"role": "user", "content": f"Content of {url}:\n\n{md}"})
                except Exception as e:
                    trace.append(TraceEntry(action="fetch.error", detail=str(e)[:160]))
                    messages.append({
                        "role": "user",
                        "content": f"Fetch failed for {url}: {e}. Try a different URL or answer with what you have.",
                    })
                continue

            trace.append(TraceEntry(action="unknown_tool", detail=str(tool)[:60]))
            messages.append({"role": "assistant", "content": reply})
            messages.append({
                "role": "user",
                "content": "Unknown tool. Use exactly one of: search, fetch, answer.",
            })

        trace.append(TraceEntry(action="iteration_cap", detail=str(req.maxIterations)))
        return ResearchResponse(
            answer="(reached the iteration cap without a final answer — try a more specific question)",
            trace=trace,
            iterations=req.maxIterations,
        )

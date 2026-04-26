"""Quick Fix GPU worker.

Runs two things in one process:
  1. A background Redis consumer loop (BRPOP priority queues → BiRefNet → Supabase upload)
  2. A small FastAPI server exposing /health for liveness checks
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import time
from contextlib import asynccontextmanager
from typing import Any

import httpx
import redis.asyncio as redis_async
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from inference import InferenceEngine, ModelName
from upscaler import UpscaleEngine
import pdf_edit

load_dotenv()

REDIS_URL = os.environ["REDIS_URL"]
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WORKER_ID = os.environ.get("WORKER_ID", "worker-1")
DEVICE = os.environ.get("DEVICE", "cuda")
PORT = int(os.environ.get("PORT", "8000"))
# Optional — if unset, the "email me when done" feature silently no-ops.
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
RESEND_FROM = os.environ.get("RESEND_FROM", "Quick Fix <notifications@updates.quickfix.app>")
APP_URL = os.environ.get("APP_URL", "https://46-224-45-79.sslip.io")

QUEUE_KEYS = [
    "jobs:priority:high",
    "jobs:priority:mid",
    "jobs:priority:low",
]

engine = InferenceEngine(device=DEVICE)
upscaler = UpscaleEngine(device=DEVICE)
_stop = asyncio.Event()


def log(msg: str, **fields: Any):
    payload = {"worker": WORKER_ID, "msg": msg, **fields}
    print(json.dumps(payload), flush=True)


async def supabase_request(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    *,
    json_body: dict | None = None,
    content: bytes | None = None,
    content_type: str | None = None,
) -> httpx.Response:
    headers = {
        "apikey": SUPABASE_KEY,
        "authorization": f"Bearer {SUPABASE_KEY}",
    }
    if content_type:
        headers["content-type"] = content_type
    if json_body is not None:
        headers["content-type"] = "application/json"
    return await client.request(
        method,
        f"{SUPABASE_URL}{path}",
        headers=headers,
        json=json_body,
        content=content,
        timeout=60.0,
    )


async def fetch_input(client: httpx.AsyncClient, path: str) -> bytes:
    # Storage REST: /storage/v1/object/<bucket>/<path>
    url = f"{SUPABASE_URL}/storage/v1/object/images/{path}"
    r = await client.get(
        url,
        headers={
            "apikey": SUPABASE_KEY,
            "authorization": f"Bearer {SUPABASE_KEY}",
        },
        timeout=60.0,
    )
    r.raise_for_status()
    return r.content


async def upload_output(client: httpx.AsyncClient, path: str, data: bytes) -> None:
    url = f"{SUPABASE_URL}/storage/v1/object/images/{path}"
    r = await client.post(
        url,
        headers={
            "apikey": SUPABASE_KEY,
            "authorization": f"Bearer {SUPABASE_KEY}",
            "content-type": "image/png",
            "x-upsert": "true",
        },
        content=data,
        timeout=120.0,
    )
    r.raise_for_status()


async def patch_job(client: httpx.AsyncClient, job_id: str, fields: dict) -> None:
    # PostgREST PATCH against `jobs` table
    r = await supabase_request(
        client,
        "PATCH",
        f"/rest/v1/jobs?id=eq.{job_id}",
        json_body=fields,
    )
    if r.status_code >= 300:
        log("patch_job failed", status=r.status_code, body=r.text, job_id=job_id)


async def record_success(client: httpx.AsyncClient, job: dict) -> None:
    body = {
        "user_id": job.get("user_id"),
        "anon_fingerprint": job.get("anon_fingerprint"),
        "anon_ip": job.get("anon_ip"),
        "event_type": "job_succeeded",
        "credits_delta": 0,
        "job_id": job["id"],
    }
    r = await supabase_request(client, "POST", "/rest/v1/usage_events", json_body=body)
    if r.status_code >= 300:
        log("usage_events insert failed", status=r.status_code, body=r.text)


async def fetch_job(client: httpx.AsyncClient, job_id: str) -> dict | None:
    r = await supabase_request(
        client,
        "GET",
        f"/rest/v1/jobs?id=eq.{job_id}&select=id,user_id,anon_fingerprint,anon_ip,tier",
    )
    if r.status_code >= 300:
        log("fetch_job failed", status=r.status_code, body=r.text)
        return None
    rows = r.json()
    return rows[0] if rows else None


async def process_one(
    client: httpx.AsyncClient,
    payload: dict,
) -> None:
    job_id = payload["jobId"]
    tool = payload.get("tool", "bg-remove")
    input_path = payload["inputPath"]
    notify_email = payload.get("notifyEmail")
    # bg-remove-specific options
    model: ModelName = payload.get("model", "birefnet")
    max_out = int(payload.get("maxOutputDimension", 0))
    feather = float(payload.get("featherRadius", 0.8))
    auto_crop = bool(payload.get("autoCrop", False))
    # upscale-specific options
    scale = int(payload.get("scale", 2))

    t0 = time.monotonic()
    log("job.start", job_id=job_id, tool=tool, model=model, scale=scale)

    await patch_job(
        client,
        job_id,
        {"status": "processing", "worker_id": WORKER_ID, "started_at": _now_iso()},
    )

    try:
        image_bytes = await fetch_input(client, input_path)
        if tool == "upscale":
            if scale not in (2, 4):
                raise ValueError(f"unsupported scale {scale}")
            out_bytes = await asyncio.to_thread(
                upscaler.upscale, image_bytes, scale
            )
        else:
            out_bytes = await asyncio.to_thread(
                engine.remove_background,
                image_bytes,
                model,
                max_out,
                feather,
                auto_crop,
            )
        output_path = f"output/{job_id}.png"
        await upload_output(client, output_path, out_bytes)

        await patch_job(
            client,
            job_id,
            {
                "status": "succeeded",
                "output_path": output_path,
                "finished_at": _now_iso(),
            },
        )
        job = await fetch_job(client, job_id)
        if job:
            await record_success(client, job)
        if notify_email:
            await send_notify_email(client, job_id, output_path, notify_email)
        log("job.ok", job_id=job_id, ms=int((time.monotonic() - t0) * 1000))
    except Exception as e:
        log("job.fail", job_id=job_id, error=str(e))
        await patch_job(
            client,
            job_id,
            {
                "status": "failed",
                "error": str(e)[:500],
                "finished_at": _now_iso(),
            },
        )


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


async def _create_signed_url(client: httpx.AsyncClient, object_path: str, seconds: int = 24 * 3600) -> str | None:
    # Storage REST: sign an object for download.
    url = f"{SUPABASE_URL}/storage/v1/object/sign/images/{object_path}"
    r = await client.post(
        url,
        headers={
            "apikey": SUPABASE_KEY,
            "authorization": f"Bearer {SUPABASE_KEY}",
            "content-type": "application/json",
        },
        json={"expiresIn": seconds},
        timeout=30.0,
    )
    if r.status_code >= 300:
        log("signed_url failed", status=r.status_code, body=r.text)
        return None
    data = r.json()
    signed = data.get("signedURL") or data.get("signedUrl")
    if not signed:
        return None
    return f"{SUPABASE_URL}/storage/v1{signed}"


async def send_notify_email(
    client: httpx.AsyncClient,
    job_id: str,
    output_path: str,
    to_email: str,
) -> None:
    if not RESEND_API_KEY:
        log("notify.skip", reason="RESEND_API_KEY not set", job_id=job_id)
        return

    url = await _create_signed_url(client, output_path, 24 * 3600)
    if not url:
        log("notify.skip", reason="could not create signed URL", job_id=job_id)
        return

    subject = "Your Quick Fix image is ready"
    html = f"""
    <!doctype html>
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 12px">Your image is ready</h1>
      <p style="color:#555;margin:0 0 16px">
        Quick Fix finished removing the background.
      </p>
      <p>
        <a href="{url}" style="background:#7c5cff;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Download the image</a>
      </p>
      <p style="color:#888;font-size:12px;margin-top:24px">
        This link expires in 24 hours. Job ID: {job_id}
      </p>
    </div>
    """
    try:
        r = await client.post(
            "https://api.resend.com/emails",
            headers={
                "authorization": f"Bearer {RESEND_API_KEY}",
                "content-type": "application/json",
            },
            json={
                "from": RESEND_FROM,
                "to": [to_email],
                "subject": subject,
                "html": html,
            },
            timeout=30.0,
        )
        if r.status_code >= 300:
            log("notify.error", status=r.status_code, body=r.text[:300])
        else:
            log("notify.sent", to=to_email, job_id=job_id)
    except Exception as e:
        log("notify.exception", error=str(e))


async def worker_loop():
    r = redis_async.from_url(REDIS_URL, decode_responses=True)
    async with httpx.AsyncClient() as client:
        log("worker.ready", device=engine.device)
        while not _stop.is_set():
            try:
                popped = await r.brpop(QUEUE_KEYS, timeout=5)
                if popped is None:
                    continue
                _, raw = popped
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError as e:
                    log("bad_payload", error=str(e), raw=raw[:200])
                    continue
                await process_one(client, payload)
            except asyncio.CancelledError:
                break
            except Exception as e:
                log("loop.error", error=str(e))
                await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    engine.warmup()
    task = asyncio.create_task(worker_loop())
    try:
        yield
    finally:
        _stop.set()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True, "worker": WORKER_ID, "device": engine.device}


# ---- PDF text editing (synchronous CPU endpoints) -----------------------
#
# Unlike bg-remove/upscale which go through Redis for batching, PDF parse
# and apply are interactive: the user is waiting in the editor. We expose
# them as direct HTTP endpoints, called from the Next.js app via the
# internal docker network.


class PdfParseRequest(BaseModel):
    inputPath: str  # storage path, e.g. "pdfs/<sessionId>/original.pdf"


class PdfEditItem(BaseModel):
    pageNumber: int
    blockId: str
    newText: str


class PdfApplyRequest(BaseModel):
    inputPath: str
    edits: list[PdfEditItem]


async def _fetch_pdf_bytes(client: httpx.AsyncClient, path: str) -> bytes:
    return await fetch_input(client, path)


async def _upload_pdf_bytes(client: httpx.AsyncClient, path: str, data: bytes) -> None:
    url = f"{SUPABASE_URL}/storage/v1/object/images/{path}"
    r = await client.post(
        url,
        headers={
            "apikey": SUPABASE_KEY,
            "authorization": f"Bearer {SUPABASE_KEY}",
            "content-type": "application/pdf",
            "x-upsert": "true",
        },
        content=data,
        timeout=120.0,
    )
    r.raise_for_status()


@app.post("/pdf/parse")
async def pdf_parse(req: PdfParseRequest):
    async with httpx.AsyncClient() as client:
        try:
            pdf_bytes = await _fetch_pdf_bytes(client, req.inputPath)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"could not fetch PDF: {e}")
    try:
        result = await asyncio.to_thread(pdf_edit.parse_pdf, pdf_bytes)
    except Exception as e:
        log("pdf.parse.error", error=str(e), input=req.inputPath)
        raise HTTPException(status_code=400, detail=str(e))
    log("pdf.parse.ok", input=req.inputPath, pages=result["pageCount"])
    return result


@app.post("/pdf/apply")
async def pdf_apply(req: PdfApplyRequest):
    async with httpx.AsyncClient() as client:
        try:
            pdf_bytes = await _fetch_pdf_bytes(client, req.inputPath)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"could not fetch PDF: {e}")

        edits_dict = [e.model_dump() for e in req.edits]
        try:
            edited = await asyncio.to_thread(pdf_edit.apply_edits, pdf_bytes, edits_dict)
        except Exception as e:
            log("pdf.apply.error", error=str(e), input=req.inputPath)
            raise HTTPException(status_code=400, detail=str(e))

        # Save under same session prefix.
        prefix = req.inputPath.rsplit("/", 1)[0]
        out_path = f"{prefix}/edited.pdf"
        try:
            await _upload_pdf_bytes(client, out_path, edited)
        except Exception as e:
            log("pdf.apply.upload_error", error=str(e))
            raise HTTPException(status_code=500, detail=f"upload failed: {e}")

        log("pdf.apply.ok", input=req.inputPath, output=out_path, edits=len(edits_dict))
        return {"outputPath": out_path}


def _install_signal_handlers(loop: asyncio.AbstractEventLoop):
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _stop.set)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level="info")

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
const WORKER_URL = process.env.WORKER_URL ?? "http://worker:8000";

// Allow PDF uploads up to 12MB (some browsers add overhead).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const rl = await rateLimit({
    scope: `pdf-edit:${ip}`,
    limit: 8,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }
  if (file.type && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 415 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `PDF too large (max ${MAX_PDF_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    );
  }

  const sessionId = randomUUID();
  const inputPath = `pdfs/${sessionId}/original.pdf`;

  const admin = supabaseAdmin();
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadErr } = await admin.storage
    .from("images")
    .upload(inputPath, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadErr) {
    console.error("[pdf-parse] storage upload failed", uploadErr);
    return NextResponse.json({ error: "Could not store PDF" }, { status: 500 });
  }

  // Call worker to parse + render pages.
  let parsed: unknown;
  try {
    const r = await fetch(`${WORKER_URL}/pdf/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath }),
      // Parsing a 10-page PDF can take several seconds (mostly rendering).
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return NextResponse.json(
        { error: `Worker rejected PDF: ${detail.slice(0, 300) || r.statusText}` },
        { status: 400 }
      );
    }
    parsed = await r.json();
  } catch (e) {
    console.error("[pdf-parse] worker call failed", e);
    return NextResponse.json(
      { error: "PDF service unavailable. Please try again." },
      { status: 503 }
    );
  }

  return NextResponse.json({
    sessionId,
    ...(parsed as object),
  });
}

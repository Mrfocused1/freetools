import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const WORKER_URL = process.env.WORKER_URL ?? "http://worker:8000";

const Body = z.object({
  sessionId: z.string().uuid(),
  edits: z.array(
    z.object({
      pageNumber: z.number().int().positive(),
      blockId: z.string().min(1).max(64),
      newText: z.string().max(2000),
    })
  ).min(1).max(500),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const rl = await rateLimit({
    scope: `pdf-apply:${ip}`,
    limit: 12,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { sessionId, edits } = parsed.data;
  const inputPath = `pdfs/${sessionId}/original.pdf`;

  // Call worker.
  let outputPath: string;
  try {
    const r = await fetch(`${WORKER_URL}/pdf/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath, edits }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return NextResponse.json(
        { error: `Apply failed: ${detail.slice(0, 300) || r.statusText}` },
        { status: 400 }
      );
    }
    const json = (await r.json()) as { outputPath: string };
    outputPath = json.outputPath;
  } catch (e) {
    console.error("[pdf-apply] worker call failed", e);
    return NextResponse.json({ error: "PDF service unavailable" }, { status: 503 });
  }

  const admin = supabaseAdmin();
  const { data: signed, error: signErr } = await admin.storage
    .from("images")
    .createSignedUrl(outputPath, 60 * 60); // 1 hour
  if (signErr || !signed) {
    console.error("[pdf-apply] signed url failed", signErr);
    return NextResponse.json({ error: "Could not create download link" }, { status: 500 });
  }

  return NextResponse.json({ downloadUrl: signed.signedUrl });
}

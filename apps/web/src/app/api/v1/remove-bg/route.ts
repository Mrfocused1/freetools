import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticateApiKey } from "@/lib/api-keys";
import { redis, queueKeyForTier, type QueuePayload } from "@/lib/redis";
import { TIERS, MAX_UPLOAD_BYTES, ALLOWED_MIME } from "@/lib/tiers";
import { rateLimit } from "@/lib/rate-limit";
import { canSubmit, getMonthUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow up to 5 minutes for a sync job.
export const maxDuration = 300;

// POST binary image body with content-type: image/jpeg|png|webp.
// Optional query params: hair=1, auto_crop=1, feather=0.8
export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });

  const tierCfg = TIERS[auth.tier];
  if (tierCfg.apiAccess === "none") {
    return NextResponse.json({ error: "API access requires Pro or Business" }, { status: 403 });
  }

  // Rate limit: Pro = 60 rpm, Business = 600 rpm.
  const limit = tierCfg.apiAccess === "full" ? 600 : 60;
  const rl = await rateLimit({
    scope: `api:${auth.keyId}`,
    limit,
    windowMs: 60_000,
  });
  if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  // Quota check
  const gate = await canSubmit({ userId: auth.userId, tier: auth.tier });
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 402 });

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
  if (!ALLOWED_MIME.includes(contentType as typeof ALLOWED_MIME[number])) {
    return NextResponse.json(
      { error: `Unsupported content-type: ${contentType}. Use image/jpeg, image/png, or image/webp.` },
      { status: 415 }
    );
  }
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length === 0) return NextResponse.json({ error: "Empty body" }, { status: 400 });
  if (body.length > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File too large" }, { status: 413 });

  const sp = req.nextUrl.searchParams;
  const hair = sp.get("hair") === "1";
  const autoCrop = sp.get("auto_crop") === "1";
  const feather = Number.parseFloat(sp.get("feather") ?? "0.8");

  // Upload to Supabase storage, then enqueue, then poll for result.
  const admin = supabaseAdmin();
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const inputPath = `input/${auth.userId}/api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await admin.storage.from("images").upload(inputPath, body, {
    contentType,
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: "Storage upload failed" }, { status: 500 });

  // Create job row and enqueue.
  const chosenModel = hair ? "birefnet-matting" : tierCfg.model;
  const { data: job } = await admin
    .from("jobs")
    .insert({
      user_id: auth.userId,
      status: "queued",
      tier: auth.tier,
      tool: "bg-remove",
      input_path: inputPath,
      input_bytes: body.length,
      model: chosenModel,
      options: {
        featherRadius: Number.isFinite(feather) ? feather : 0.8,
        autoCrop,
        apiKeyId: auth.keyId,
      },
    })
    .select("id")
    .single();
  if (!job) return NextResponse.json({ error: "Could not create job" }, { status: 500 });

  const payload: QueuePayload = {
    jobId: job.id,
    tier: auth.tier,
    tool: "bg-remove",
    model: chosenModel,
    inputPath,
    maxOutputDimension: tierCfg.maxOutputDimension,
    featherRadius: Number.isFinite(feather) ? feather : 0.8,
    autoCrop,
  };
  await redis().lpush(queueKeyForTier(auth.tier), JSON.stringify(payload));

  // Poll for the result up to 5 minutes.
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    const { data: row } = await admin
      .from("jobs")
      .select("status, output_path, error")
      .eq("id", job.id)
      .single();
    if (!row) continue;
    if (row.status === "succeeded" && row.output_path) {
      const { data: signed } = await admin.storage.from("images").createSignedUrl(row.output_path, 60 * 15);
      // Return the image bytes directly. Developer-friendly.
      if (signed?.signedUrl) {
        const imgRes = await fetch(signed.signedUrl);
        const buf = await imgRes.arrayBuffer();
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "x-quickfix-job-id": job.id,
          },
        });
      }
    }
    if (row.status === "failed") {
      return NextResponse.json({ error: row.error ?? "Processing failed", jobId: job.id }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Timed out", jobId: job.id }, { status: 504 });
}

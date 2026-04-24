import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { TIERS, MAX_UPLOAD_BYTES, ALLOWED_MIME, type Tier } from "@/lib/tiers";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { anonFingerprint } from "@/lib/fingerprint";
import { canSubmit } from "@/lib/usage";

const Body = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  tool: z.enum(["bg-remove", "upscale"]).optional().default("bg-remove"),
  // bg-remove options
  hairMode: z.boolean().optional(),
  featherRadius: z.number().min(0).max(3).optional(),
  autoCrop: z.boolean().optional(),
  // upscale options
  scale: z.union([z.literal(2), z.literal(4)]).optional(),
  // shared
  notifyEmail: z.string().email().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { fileName, contentType, sizeBytes, tool, hairMode, featherRadius, autoCrop, scale, notifyEmail } = parsed.data;
  if (!ALLOWED_MIME.includes(contentType)) {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  }

  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent");

  // Identify caller
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let tier: Tier = "free";
  let userId: string | undefined;
  let creditBalance = 0;
  let anonFp: string | undefined;

  const admin = supabaseAdmin();

  if (user) {
    userId = user.id;
    const { data: profile } = await admin
      .from("profiles")
      .select("tier, credit_balance")
      .eq("id", user.id)
      .single();
    tier = (profile?.tier as Tier) ?? "free";
    creditBalance = profile?.credit_balance ?? 0;
  } else {
    anonFp = anonFingerprint(ip, ua);
  }

  // Rate limit: anon IPs hit a harder short-window cap to defend against abuse.
  const rl = await rateLimit({
    scope: userId ? `user:${userId}` : `ip:${ip}`,
    limit: userId ? 60 : 8,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please slow down." },
      { status: 429 }
    );
  }

  // Quota / tier check
  const gate = await canSubmit({ userId, anonFingerprint: anonFp, tier, creditBalance });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason }, { status: 402 });
  }

  // File size vs tier
  const cfg = TIERS[tier];
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  // Pick the model. Hair mode overrides the tier default with BiRefNet-matting.
  // For upscale jobs, `model` isn't used; we just record the tool.
  const chosenModel = tool === "bg-remove" ? (hairMode ? "birefnet-matting" : cfg.model) : null;

  const options: Record<string, unknown> = {
    notifyEmail: notifyEmail ?? null,
  };
  if (tool === "bg-remove") {
    options.featherRadius = featherRadius ?? 0.8;
    options.autoCrop = autoCrop === true;
  } else if (tool === "upscale") {
    options.scale = scale ?? 2;
  }

  const { data: job, error: jobErr } = await admin
    .from("jobs")
    .insert({
      user_id: userId ?? null,
      anon_fingerprint: anonFp ?? null,
      anon_ip: anonFp ? ip : null,
      status: "queued",
      tier,
      tool,
      input_path: "",
      input_bytes: sizeBytes,
      model: chosenModel,
      options,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    console.error("[jobs] insert failed", jobErr);
    return NextResponse.json({ error: "Could not create job" }, { status: 500 });
  }

  // Signed upload URL — scoped to a single known object key.
  const owner = userId ?? anonFp ?? "anon";
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const inputPath = `input/${owner}/${job.id}-${safeName}`;

  const { data: signed, error: signErr } = await admin.storage
    .from("images")
    .createSignedUploadUrl(inputPath);

  if (signErr || !signed) {
    console.error("[jobs] signed upload failed", signErr);
    return NextResponse.json({ error: "Could not create upload URL" }, { status: 500 });
  }

  return NextResponse.json({
    jobId: job.id,
    uploadUrl: signed.signedUrl,
    inputPath,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { redis, queueKeyForTier, type QueuePayload } from "@/lib/redis";
import { TIERS, type Tier } from "@/lib/tiers";

const Body = z.object({
  inputPath: z.string().min(1),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  const admin = supabaseAdmin();
  const { data: job, error } = await admin
    .from("jobs")
    .select("id, user_id, anon_fingerprint, tier, tool, model, status, options")
    .eq("id", id)
    .single();
  if (error) console.error("[jobs/start] fetch", error);

  if (error || !job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Ownership: if job was created by a logged-in user, require that user.
  // If anonymous, allow (fingerprint check omitted here; the job id is a UUID and only known to uploader).
  if (job.user_id && job.user_id !== user?.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (job.status !== "queued") {
    return NextResponse.json({ error: "Job already started" }, { status: 409 });
  }

  // Update input_path and enqueue.
  const tier = (job.tier as Tier) ?? "free";
  const cfg = TIERS[tier];
  // Use the model chosen at job creation time (respects hair-mode toggle).
  const chosenModel = (job.model as QueuePayload["model"]) ?? cfg.model;

  const { error: updateErr } = await admin
    .from("jobs")
    .update({ input_path: parsed.data.inputPath })
    .eq("id", id);
  if (updateErr) {
    console.error("[jobs/start] update", updateErr);
    return NextResponse.json({ error: "Failed to start" }, { status: 500 });
  }

  const jobOpts = (job.options ?? {}) as {
    featherRadius?: number;
    autoCrop?: boolean;
    notifyEmail?: string | null;
    scale?: 2 | 4;
  };
  const tool = (job.tool as "bg-remove" | "upscale") ?? "bg-remove";
  const payload: QueuePayload =
    tool === "upscale"
      ? {
          jobId: id,
          tier,
          tool,
          inputPath: parsed.data.inputPath,
          scale: jobOpts.scale ?? 2,
          notifyEmail: jobOpts.notifyEmail ?? undefined,
        }
      : {
          jobId: id,
          tier,
          tool,
          model: chosenModel,
          inputPath: parsed.data.inputPath,
          maxOutputDimension: cfg.maxOutputDimension,
          featherRadius: typeof jobOpts.featherRadius === "number" ? jobOpts.featherRadius : 0.8,
          autoCrop: jobOpts.autoCrop === true,
          notifyEmail: jobOpts.notifyEmail ?? undefined,
        };

  await redis().lpush(queueKeyForTier(tier), JSON.stringify(payload));

  return NextResponse.json({ ok: true });
}

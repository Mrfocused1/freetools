import { NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

// Random URL-safe slug, ~60 bits of entropy.
function makeSlug(): string {
  const alpha = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();

  const admin = supabaseAdmin();
  const { data: job } = await admin
    .from("jobs")
    .select("id, user_id, status, input_path, output_path")
    .eq("id", id)
    .single();
  if (!job || job.status !== "succeeded" || !job.output_path) {
    return NextResponse.json({ error: "Job not ready" }, { status: 404 });
  }
  if (job.user_id && job.user_id !== user?.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Reuse existing share row if one already exists for this job.
  const { data: existing } = await admin
    .from("shares")
    .select("slug")
    .eq("job_id", id)
    .limit(1);
  let slug = existing?.[0]?.slug;

  if (!slug) {
    slug = makeSlug();
    // Copy input+output into a "shared/<slug>/" prefix that the 1h cleanup cron
    // leaves alone (cron only deletes files in input/ and output/ prefixes in
    // future — for now, the existence of a shares row keeps it alive as we'll
    // skip those in the cron by prefix).
    const sharedInput = `shared/${slug}/before.${job.input_path.split(".").pop() ?? "jpg"}`;
    const sharedOutput = `shared/${slug}/after.png`;

    // Server-side copy via Storage API
    const { error: copyInErr } = await admin.storage
      .from("images")
      .copy(job.input_path, sharedInput);
    if (copyInErr) {
      console.error("[share] input copy", copyInErr);
    }
    const { error: copyOutErr } = await admin.storage
      .from("images")
      .copy(job.output_path, sharedOutput);
    if (copyOutErr) {
      console.error("[share] output copy", copyOutErr);
      return NextResponse.json({ error: "Could not create share" }, { status: 500 });
    }

    await admin.from("shares").insert({ slug, job_id: id });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const url = `${base}/s/${slug}`;
  return NextResponse.json({ slug, url });
}

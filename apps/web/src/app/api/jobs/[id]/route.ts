import { NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  const admin = supabaseAdmin();
  const { data: job } = await admin
    .from("jobs")
    .select("id, user_id, status, output_path, error")
    .eq("id", id)
    .single();
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Owned by a user → require that user. Anonymous → allow (only uploader knows the id).
  if (job.user_id && job.user_id !== user?.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (job.status !== "succeeded" || !job.output_path) {
    return NextResponse.json({
      status: job.status,
      error: job.error ?? undefined,
    });
  }

  // Short-lived signed URL for the processed result.
  const { data: signed } = await admin.storage
    .from("images")
    .createSignedUrl(job.output_path, 60 * 15);

  return NextResponse.json({
    status: "succeeded",
    outputUrl: signed?.signedUrl,
  });
}

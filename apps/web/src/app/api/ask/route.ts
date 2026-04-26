import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const RESEARCH_AGENT_URL = process.env.RESEARCH_AGENT_URL ?? "http://research-agent:8000";
const RESEARCH_TOKEN = process.env.RESEARCH_TOKEN;

const Body = z.object({
  query: z.string().min(2).max(800),
  gemma: z.object({
    url: z.string().url(),
    token: z.string().min(8),
  }),
  model: z.string().min(1).max(120).optional(),
  maxIterations: z.number().int().min(1).max(15).optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!RESEARCH_TOKEN) {
    return NextResponse.json(
      { error: "Server is missing RESEARCH_TOKEN configuration." },
      { status: 503 }
    );
  }

  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const ip = getClientIp(req);
  const rl = await rateLimit({
    scope: `research:${user.id}:${ip}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const r = await fetch(`${RESEARCH_AGENT_URL}/api/research`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEARCH_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(600_000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return NextResponse.json(
        { error: `Agent error: ${detail.slice(0, 400) || r.statusText}` },
        { status: r.status === 502 ? 502 : 400 }
      );
    }
    const json = await r.json();
    return NextResponse.json(json);
  } catch (e) {
    console.error("[research] proxy error", e);
    return NextResponse.json({ error: "Research service unreachable" }, { status: 503 });
  }
}

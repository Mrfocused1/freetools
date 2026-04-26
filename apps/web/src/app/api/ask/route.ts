import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const RESEARCH_AGENT_URL = process.env.RESEARCH_AGENT_URL ?? "http://research-agent:8000";
const RESEARCH_TOKEN = process.env.RESEARCH_TOKEN;

const Body = z.object({
  query: z.string().min(2).max(800),
  // Optional admin override: provide a different LLM endpoint per request.
  // Customers never set this; only the CLI tool uses it for testing.
  gemma: z
    .object({
      url: z.string().url(),
      token: z.string().min(8),
    })
    .optional(),
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

  const ip = getClientIp(req);

  // Per-IP rate limit. Keep it modest since each query fans out to multiple
  // search/fetch/LLM calls and may consume significant OpenRouter free-tier quota.
  const rl = await rateLimit({
    scope: `research:${ip}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again in a minute." }, { status: 429 });
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

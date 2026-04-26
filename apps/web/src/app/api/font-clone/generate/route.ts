import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

// FONT_GEN_URL: full base URL of the running vast.ai font-gen worker,
// e.g. http://1.2.3.4:12345. Set after running tools/font-gen/scripts/font-gen-up.sh.
const FONT_GEN_URL = process.env.FONT_GEN_URL ?? "";
const FONT_GEN_TOKEN = process.env.FONT_GEN_TOKEN ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
  "0123456789" +
  "!?.,;:'\"-@#$%&*()";

interface GenerateRequestBody {
  imageDataUrl: string;
  fontFamily?: string;
  targetCharset?: string;
}

export async function POST(req: NextRequest) {
  // Worker offline check (env not configured).
  if (!FONT_GEN_URL || !FONT_GEN_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Custom font generation is currently offline. " +
          "The GPU worker is not provisioned — check back soon.",
        offline: true,
      },
      { status: 503 }
    );
  }

  const ip = getClientIp(req);

  // Per-IP rate limit: 3 requests per 10 minutes (GPU job is expensive).
  const rl = await rateLimit({
    scope: `font-generate:${ip}`,
    limit: 3,
    windowMs: 10 * 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. You can generate up to 3 fonts per 10 minutes." },
      { status: 429 }
    );
  }

  let body: GenerateRequestBody;
  try {
    body = (await req.json()) as GenerateRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.imageDataUrl || !body.imageDataUrl.startsWith("data:")) {
    return NextResponse.json(
      { error: "Missing or invalid imageDataUrl (must be a data: URI)." },
      { status: 400 }
    );
  }

  // Rough size guard: base64 overhead means ~1.33× actual bytes.
  // Reject bodies that clearly exceed 20 MB of image data.
  const MAX_DATA_URL_CHARS = 20 * 1024 * 1024 * 1.4;
  if (body.imageDataUrl.length > MAX_DATA_URL_CHARS) {
    return NextResponse.json(
      { error: "Image data too large (max 20 MB)." },
      { status: 413 }
    );
  }

  const payload = {
    imageDataUrl: body.imageDataUrl,
    fontFamily: (body.fontFamily ?? "CustomFont").slice(0, 64),
    targetCharset: body.targetCharset ?? DEFAULT_CHARSET,
  };

  try {
    const r = await fetch(`${FONT_GEN_URL}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FONT_GEN_TOKEN}`,
      },
      body: JSON.stringify(payload),
      // Font generation can take several minutes for full charsets.
      signal: AbortSignal.timeout(8 * 60_000),
    });

    if (!r.ok) {
      const raw = await r.text().catch(() => "");
      let inner = raw;
      try {
        const parsed = JSON.parse(raw) as { detail?: string };
        if (typeof parsed?.detail === "string") inner = parsed.detail;
      } catch {
        // keep raw
      }
      return NextResponse.json(
        { error: inner.slice(0, 400) || r.statusText },
        { status: r.status >= 500 ? 502 : 400 }
      );
    }

    const json = await r.json();
    return NextResponse.json(json);
  } catch (e) {
    console.error("[font-clone/generate] proxy error", e);
    return NextResponse.json(
      { error: "Font generation worker unreachable. Please try again later." },
      { status: 503 }
    );
  }
}

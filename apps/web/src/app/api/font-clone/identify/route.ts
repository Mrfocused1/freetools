import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const FONT_WORKER_URL = process.env.FONT_WORKER_URL ?? "http://font-worker:8000";
const FONT_TOKEN = process.env.FONT_TOKEN;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Max body size for multipart upload (Next.js default is 4 MB; we allow 10 MB)
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  if (!FONT_TOKEN) {
    return NextResponse.json(
      { error: "Server is missing FONT_TOKEN configuration." },
      { status: 503 }
    );
  }

  const ip = getClientIp(req);

  // Per-IP rate limit: 15 requests per minute (generous for a CPU-bound service)
  const rl = await rateLimit({
    scope: `font-identify:${ip}`,
    limit: 15,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 }
    );
  }

  // Validate content-type
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a 'file' field." },
      { status: 400 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Failed to parse form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing 'file' field." }, { status: 400 });
  }

  // Basic file type check
  const mimeType = file.type;
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType)) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a PNG, JPEG, or WebP image." },
      { status: 415 }
    );
  }

  // Size guard (10 MB)
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Image too large (max 10 MB)." },
      { status: 413 }
    );
  }

  // Forward multipart to the font-worker
  const upstream = new FormData();
  upstream.append("file", file, (file as File).name ?? "upload.png");

  try {
    const r = await fetch(`${FONT_WORKER_URL}/api/font-clone/identify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FONT_TOKEN}`,
      },
      body: upstream,
      signal: AbortSignal.timeout(60_000),
    });

    if (!r.ok) {
      const raw = await r.text().catch(() => "");
      // Try to extract FastAPI's `detail` field for a cleaner message.
      let inner = raw;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.detail === "string") inner = parsed.detail;
      } catch {}

      // Special case: index isn't built yet — show a friendly "coming soon"
      // message instead of the developer-facing build instructions.
      if (r.status === 503 && /index is empty/i.test(inner)) {
        return NextResponse.json(
          {
            error:
              "Font Identifier is still warming up — our font index is being built. Try again in a few hours.",
            warmingUp: true,
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { error: inner.slice(0, 400) || r.statusText },
        { status: r.status === 503 ? 503 : 400 }
      );
    }

    const json = await r.json();
    return NextResponse.json(json);
  } catch (e) {
    console.error("[font-clone] proxy error", e);
    return NextResponse.json(
      { error: "Font identification service unreachable." },
      { status: 503 }
    );
  }
}

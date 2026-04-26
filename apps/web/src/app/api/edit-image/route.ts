import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux-kontext/dev";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) {
    return NextResponse.json(
      { error: "Image editing service is offline. Check back soon." },
      { status: 503 }
    );
  }

  const ip = getClientIp(req);

  // 3 edits per IP per 24 h (free tier)
  const rl = await rateLimit({
    scope: `edit-image:${ip}`,
    limit: 3,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error:
          "You've used your free edits for today. Come back tomorrow or upgrade to Pro.",
        rateLimited: true,
      },
      { status: 429 }
    );
  }

  // Parse JSON body: { imageDataUrl, prompt }
  let imageDataUrl: string;
  let prompt: string;
  try {
    const body = (await req.json()) as { imageDataUrl?: unknown; prompt?: unknown };
    if (
      typeof body.imageDataUrl !== "string" ||
      typeof body.prompt !== "string"
    ) {
      throw new Error("missing fields");
    }
    imageDataUrl = body.imageDataUrl;
    prompt = body.prompt;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body. Expected { imageDataUrl, prompt }." },
      { status: 400 }
    );
  }

  // Validate data URL
  if (!imageDataUrl.startsWith("data:")) {
    return NextResponse.json(
      { error: "imageDataUrl must be a data URL." },
      { status: 400 }
    );
  }
  const mimeMatch = imageDataUrl.match(/^data:([^;]+);base64,/);
  const mime = mimeMatch?.[1] ?? "";
  if (!ALLOWED_TYPES.includes(mime)) {
    return NextResponse.json(
      { error: "Unsupported image type. Use PNG, JPEG, or WebP." },
      { status: 400 }
    );
  }
  // Rough size check: base64 overhead ~4/3
  const base64Part = imageDataUrl.split(",")[1] ?? "";
  if (base64Part.length * 0.75 > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image too large. Maximum file size is 10 MB." },
      { status: 400 }
    );
  }

  // Validate prompt
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length < 3 || trimmedPrompt.length > 500) {
    return NextResponse.json(
      { error: "Prompt must be between 3 and 500 characters." },
      { status: 400 }
    );
  }

  // Call fal.ai
  try {
    const falRes = await fetch(FAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageDataUrl,
        prompt: trimmedPrompt,
        guidance_scale: 3.5,
        num_inference_steps: 28,
        num_images: 1,
        output_format: "png",
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!falRes.ok) {
      if (falRes.status === 429) {
        return NextResponse.json(
          {
            error: "Image edit service is busy. Try again in a minute.",
            upstream: true,
          },
          { status: 429 }
        );
      }
      if (falRes.status === 401) {
        console.error("[edit-image] fal.ai 401 — check FAL_KEY");
        return NextResponse.json(
          { error: "Image editing service is offline. Check back soon." },
          { status: 503 }
        );
      }
      const detail = await falRes
        .json()
        .then((j: { detail?: string }) => j.detail ?? "")
        .catch(() => "");
      return NextResponse.json(
        { error: `Edit failed: ${detail || falRes.statusText}` },
        { status: 400 }
      );
    }

    const json = (await falRes.json()) as {
      images: Array<{ url: string; width: number; height: number }>;
      seed: number;
    };

    const editedUrl = json.images?.[0]?.url;
    if (!editedUrl) {
      return NextResponse.json(
        { error: "No output image returned from the edit service." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      editedUrl,
      seed: json.seed ?? null,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Edit timed out after 60 seconds. Try a simpler prompt." },
        { status: 504 }
      );
    }
    console.error("[edit-image] unexpected error", e);
    return NextResponse.json(
      { error: "Image editing service unreachable." },
      { status: 503 }
    );
  }
}

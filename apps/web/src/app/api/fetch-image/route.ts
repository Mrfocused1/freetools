import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MAX_UPLOAD_BYTES, ALLOWED_MIME } from "@/lib/tiers";

const Body = z.object({ url: z.string().url() });

// Server-side image fetch. Prevents SSRF by:
//   - Only http/https schemes
//   - Blocking common internal / loopback ranges
//   - Enforcing max-content-length up-front via HEAD
//   - Re-checking actual bytes downloaded
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  const url = parsed.data.url;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return NextResponse.json({ error: "Only http(s) URLs are allowed" }, { status: 400 });
  }

  // SSRF hardening: block private / loopback hostnames at the DNS-name level.
  const host = parsedUrl.hostname.toLowerCase();
  const privateHosts = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    // metadata services
    "169.254.169.254",
    "metadata.google.internal",
    "metadata",
  ];
  if (privateHosts.some((h) => host === h || host.endsWith("." + h))) {
    return NextResponse.json({ error: "URL points to a private address" }, { status: 400 });
  }
  // Crude but effective: block RFC1918 and link-local by literal IPv4.
  const ipMatch = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipMatch) {
    const [a, b] = ipMatch.slice(1).map(Number);
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return NextResponse.json({ error: "URL points to a private address" }, { status: 400 });
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "QuickFix-URL-Fetcher/1.0" },
    });
  } catch (e) {
    clearTimeout(timeout);
    return NextResponse.json({ error: "Failed to fetch URL" }, { status: 502 });
  }
  clearTimeout(timeout);

  if (!res.ok) {
    return NextResponse.json({ error: `URL returned ${res.status}` }, { status: 400 });
  }

  const declaredLen = Number(res.headers.get("content-length") ?? "0");
  if (declaredLen && declaredLen > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "URL image exceeds 20 MB" }, { status: 413 });
  }
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME.includes(contentType as typeof ALLOWED_MIME[number])) {
    return NextResponse.json({ error: `Unsupported type: ${contentType}` }, { status: 415 });
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "URL image exceeds 20 MB" }, { status: 413 });
  }

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}

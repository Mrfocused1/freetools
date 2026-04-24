import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "API Docs — Quick Fix",
  description: "Sync HTTP API for background removal and upscaling. Pro ($9/mo) and Business ($29/mo).",
};

export default function ApiDocsPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <header>
          <h1 className="text-4xl font-semibold tracking-tight">API Docs</h1>
          <p className="mt-2 text-[var(--color-muted)]">
            Simple synchronous HTTP API for background removal and upscaling. Available on Pro and Business plans.
          </p>
        </header>

        <Section title="Authentication">
          <p>
            Every request needs a <code>Bearer</code> token in the <code>Authorization</code> header.
            Generate one in your{" "}
            <Link href="/dashboard/api-keys" className="underline decoration-dotted">
              API keys dashboard
            </Link>
            .
          </p>
          <Pre>{`curl -H "Authorization: Bearer qf_live_..." \\
     --data-binary @photo.jpg \\
     -H "Content-Type: image/jpeg" \\
     https://46-224-45-79.sslip.io/api/v1/remove-bg \\
     --output output.png`}</Pre>
        </Section>

        <Section title="Endpoints">
          <p><code>POST /api/v1/remove-bg</code> — Remove background, return transparent PNG.</p>
          <p><code>POST /api/v1/upscale</code> — 2× or 4× upscale, return PNG.</p>
        </Section>

        <Section title="POST /api/v1/remove-bg">
          <p><strong>Body:</strong> binary image bytes (not multipart).</p>
          <p><strong>Content-Type:</strong> <code>image/jpeg</code>, <code>image/png</code>, or <code>image/webp</code>. Max 20 MB.</p>
          <p><strong>Query parameters</strong> (all optional):</p>
          <ul className="list-inside list-disc space-y-1 pl-4">
            <li><code>hair=1</code> — use the BiRefNet-matting model for fine hair/fur edges (slower)</li>
            <li><code>auto_crop=1</code> — crop output tightly to the subject with 5% padding</li>
            <li><code>feather=0.8</code> — edge softness in px (0 = razor sharp, 3 = very soft)</li>
          </ul>
          <p><strong>Response:</strong> <code>200 OK</code> with <code>image/png</code> body. Job id returned in <code>X-Quickfix-Job-Id</code> header.</p>
        </Section>

        <Section title="POST /api/v1/upscale">
          <p><strong>Body:</strong> binary image bytes.</p>
          <p><strong>Query parameters:</strong></p>
          <ul className="list-inside list-disc space-y-1 pl-4">
            <li><code>scale=2</code> (default) — 2× upscale using lightweight Swin2SR</li>
            <li><code>scale=4</code> — 4× upscale using BSRGAN-trained Swin2SR (slower)</li>
          </ul>
          <p><strong>Response:</strong> <code>200 OK</code> with <code>image/png</code> body.</p>
        </Section>

        <Section title="Rate limits">
          <ul className="list-inside list-disc space-y-1 pl-4">
            <li>Pro: <strong>60 requests/minute</strong></li>
            <li>Business: <strong>600 requests/minute</strong></li>
          </ul>
          <p>Over the limit returns <code>429 Too Many Requests</code>.</p>
        </Section>

        <Section title="Errors">
          <ul className="list-inside list-disc space-y-1 pl-4">
            <li><code>401</code> — Missing or invalid API key</li>
            <li><code>402</code> — Plan limit reached (buy credits or upgrade)</li>
            <li><code>403</code> — API access not enabled on your plan</li>
            <li><code>413</code> — File too large (&gt; 20 MB)</li>
            <li><code>415</code> — Unsupported <code>Content-Type</code></li>
            <li><code>429</code> — Rate limit exceeded</li>
            <li><code>504</code> — Processing took longer than the API's wait window</li>
          </ul>
        </Section>

        <Section title="Examples">
          <p><strong>Node.js</strong></p>
          <Pre>{`import { readFile, writeFile } from "node:fs/promises";

const body = await readFile("photo.jpg");
const res = await fetch("https://46-224-45-79.sslip.io/api/v1/remove-bg?hair=1", {
  method: "POST",
  headers: {
    "authorization": "Bearer qf_live_...",
    "content-type": "image/jpeg",
  },
  body,
});
const out = Buffer.from(await res.arrayBuffer());
await writeFile("output.png", out);`}</Pre>

          <p className="mt-6"><strong>Python</strong></p>
          <Pre>{`import requests

with open("photo.jpg", "rb") as f:
    body = f.read()

r = requests.post(
    "https://46-224-45-79.sslip.io/api/v1/remove-bg",
    params={"hair": 1},
    headers={
        "authorization": "Bearer qf_live_...",
        "content-type": "image/jpeg",
    },
    data=body,
)
with open("output.png", "wb") as f:
    f.write(r.content)`}</Pre>
        </Section>

        <Section title="Webhooks (Business)">
          <p>Webhook-based async processing is on the roadmap — contact support if you need it now.</p>
        </Section>
      </main>
      <Footer />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm text-[var(--color-muted)]">{children}</div>
    </section>
  );
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs">
      <code>{children}</code>
    </pre>
  );
}

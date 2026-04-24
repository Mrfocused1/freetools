import { ImageResponse } from "next/og";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const alt = "Before & after — Quick Fix";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = { slug: string };

export default async function Image({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const admin = supabaseAdmin();

  const { data: afterSigned } = await admin.storage
    .from("images")
    .createSignedUrl(`shared/${slug}/after.png`, 60 * 60);

  const afterUrl = afterSigned?.signedUrl;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0a0a0b",
          color: "#f4f4f5",
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "#7c5cff" }} />
          <div style={{ fontSize: 32, fontWeight: 600 }}>Quick Fix</div>
        </div>

        <div
          style={{
            flex: 1,
            marginTop: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 32,
          }}
        >
          {afterUrl && (
            <img
              src={afterUrl}
              width={420}
              height={420}
              style={{
                objectFit: "contain",
                borderRadius: 16,
                background:
                  "repeating-conic-gradient(#1f1f28 0% 25%, #2a2a35 0% 50%) 50% / 24px 24px",
              }}
            />
          )}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 520 }}>
            <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.1 }}>
              Background removed.
            </div>
            <div style={{ marginTop: 20, fontSize: 26, color: "#9ca3af", lineHeight: 1.4 }}>
              State-of-the-art AI, free to try. No signup for the first 20 images.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
          <div style={{ fontSize: 22, color: "#9ca3af" }}>quickfix.app</div>
          <div style={{ fontSize: 22, color: "#7c5cff" }}>Try it →</div>
        </div>
      </div>
    ),
    { ...size }
  );
}

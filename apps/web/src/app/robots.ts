import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://46-224-45-79.sslip.io";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}

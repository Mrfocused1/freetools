import type { MetadataRoute } from "next";
import { USE_CASES } from "@/lib/use-cases";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://46-224-45-79.sslip.io";
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`,         lastModified: now, priority: 1.0 },
    { url: `${base}/upscale`,  lastModified: now, priority: 0.9 },
    { url: `${base}/pricing`,  lastModified: now, priority: 0.8 },
    { url: `${base}/docs/api`, lastModified: now, priority: 0.6 },
    { url: `${base}/login`,    lastModified: now, priority: 0.5 },
  ];
  const useCaseEntries: MetadataRoute.Sitemap = USE_CASES.map((u) => ({
    url: `${base}/use-case/${u.slug}`,
    lastModified: now,
    priority: 0.7,
  }));
  return [...staticEntries, ...useCaseEntries];
}

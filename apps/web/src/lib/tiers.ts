export type Tier = "free" | "pro" | "business";

export type TierConfig = {
  name: string;
  monthlyImages: number;
  maxInputPixels: number;        // max width*height
  maxInputDimension: number;     // max of width/height, used for a simpler check
  maxOutputDimension: number;    // longest side cap on output (0 = unlimited)
  batchSize: number;
  apiAccess: "none" | "basic" | "full";
  model: "birefnet" | "birefnet-2k" | "birefnet+vitmatte";
  queuePriority: number;         // lower = higher priority
  monthlyPriceUsd: number;
};

export const TIERS: Record<Tier, TierConfig> = {
  free: {
    name: "Free",
    monthlyImages: 20,
    maxInputPixels: 2048 * 2048,
    maxInputDimension: 2048,
    maxOutputDimension: 1024,
    batchSize: 1,
    apiAccess: "none",
    model: "birefnet",
    queuePriority: 30,
    monthlyPriceUsd: 0,
  },
  pro: {
    name: "Pro",
    monthlyImages: 500,
    maxInputPixels: 4096 * 4096,
    maxInputDimension: 4096,
    maxOutputDimension: 0,
    batchSize: 20,
    apiAccess: "basic",
    model: "birefnet-2k",
    queuePriority: 20,
    monthlyPriceUsd: 9,
  },
  business: {
    name: "Business",
    monthlyImages: 5000,
    maxInputPixels: 8192 * 8192,
    maxInputDimension: 8192,
    maxOutputDimension: 0,
    batchSize: 100,
    apiAccess: "full",
    model: "birefnet+vitmatte",
    queuePriority: 10,
    monthlyPriceUsd: 29,
  },
};

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB, hard cap across all tiers
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

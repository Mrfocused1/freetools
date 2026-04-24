import Redis from "ioredis";

let client: Redis | null = null;

export function redis(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    client.on("error", (err) => {
      console.error("[redis] error", err);
    });
  }
  return client;
}

// Queue names are priority-ordered; the worker BRPOPs all three in order.
export const QUEUE_KEYS = {
  high: "jobs:priority:high",     // business
  mid: "jobs:priority:mid",       // pro
  low: "jobs:priority:low",       // free
} as const;

export function queueKeyForTier(tier: "free" | "pro" | "business") {
  if (tier === "business") return QUEUE_KEYS.high;
  if (tier === "pro") return QUEUE_KEYS.mid;
  return QUEUE_KEYS.low;
}

export type QueuePayload = {
  jobId: string;
  tier: "free" | "pro" | "business";
  tool: "bg-remove" | "upscale";
  inputPath: string;
  // bg-remove
  model?: "birefnet" | "birefnet-2k" | "birefnet-matting" | "birefnet+vitmatte";
  maxOutputDimension?: number;
  featherRadius?: number;
  autoCrop?: boolean;
  // upscale
  scale?: 2 | 4;
  // shared
  notifyEmail?: string;
};

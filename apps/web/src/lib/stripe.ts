import Stripe from "stripe";

let stripeSingleton: Stripe | null = null;

export function stripe(): Stripe {
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    });
  }
  return stripeSingleton;
}

export const PRICE_TO_TIER: Record<string, "pro" | "business"> = {
  [process.env.STRIPE_PRICE_PRO ?? ""]: "pro",
  [process.env.STRIPE_PRICE_BUSINESS ?? ""]: "business",
};

export const PRICE_TO_CREDITS: Record<string, number> = {
  [process.env.STRIPE_PRICE_CREDITS_SMALL ?? ""]: 100,
  [process.env.STRIPE_PRICE_CREDITS_LARGE ?? ""]: 1000,
};

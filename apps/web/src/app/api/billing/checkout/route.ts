import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

const Body = z.union([
  z.object({ tier: z.enum(["pro", "business"]) }),
  z.object({ credits: z.enum(["small", "large"]) }),
]);

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to upgrade" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id, email")
    .eq("id", user.id)
    .single();

  const s = stripe();

  // Ensure Stripe customer exists
  let customerId = profile?.stripe_customer_id;
  if (!customerId) {
    const customer = await s.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    await admin
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", user.id);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  let priceId: string;
  let mode: "subscription" | "payment";

  if ("tier" in parsed.data) {
    priceId = parsed.data.tier === "pro"
      ? process.env.STRIPE_PRICE_PRO!
      : process.env.STRIPE_PRICE_BUSINESS!;
    mode = "subscription";
  } else {
    priceId = parsed.data.credits === "small"
      ? process.env.STRIPE_PRICE_CREDITS_SMALL!
      : process.env.STRIPE_PRICE_CREDITS_LARGE!;
    mode = "payment";
  }

  if (!priceId) {
    return NextResponse.json({ error: "Price not configured" }, { status: 500 });
  }

  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard?upgraded=1`,
    cancel_url: `${appUrl}/pricing`,
    allow_promotion_codes: true,
    metadata: { user_id: user.id },
  });

  return NextResponse.json({ url: session.url });
}

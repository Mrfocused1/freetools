import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, PRICE_TO_TIER, PRICE_TO_CREDITS } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Raw body required for signature verification.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("[stripe] signature verification failed", err);
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // Idempotency — Stripe retries on failure.
  const { error: dedupeErr } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });
  if (dedupeErr) {
    // Already processed — respond 200 so Stripe stops retrying.
    return NextResponse.json({ received: true, deduped: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        if (!userId) break;

        if (session.mode === "payment") {
          // One-time credit pack
          const lineItems = await stripe().checkout.sessions.listLineItems(session.id, {
            expand: ["data.price"],
          });
          for (const item of lineItems.data) {
            const priceId = item.price?.id;
            if (!priceId) continue;
            const credits = PRICE_TO_CREDITS[priceId];
            if (!credits) continue;
            await admin.rpc("increment_credits", { p_user_id: userId, p_delta: credits }).then(
              () => undefined,
              async () => {
                // Fallback if RPC not present: read-modify-write (accepts a small race)
                const { data: p } = await admin
                  .from("profiles")
                  .select("credit_balance")
                  .eq("id", userId)
                  .single();
                await admin
                  .from("profiles")
                  .update({ credit_balance: (p?.credit_balance ?? 0) + credits })
                  .eq("id", userId);
              }
            );
            await admin.from("usage_events").insert({
              user_id: userId,
              event_type: "credit_purchase",
              credits_delta: credits,
            });
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const priceId = sub.items.data[0]?.price.id;
        const tier = priceId ? PRICE_TO_TIER[priceId] : undefined;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

        const { data: profile } = await admin
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();
        if (!profile) break;

        const active = sub.status === "active" || sub.status === "trialing";

        await admin
          .from("profiles")
          .update({
            tier: active && tier ? tier : "free",
            stripe_subscription_id: sub.id,
            subscription_current_period_end: new Date(
              sub.current_period_end * 1000
            ).toISOString(),
          })
          .eq("id", profile.id);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        await admin
          .from("profiles")
          .update({ tier: "free", stripe_subscription_id: null })
          .eq("stripe_customer_id", customerId);
        break;
      }
    }
  } catch (err) {
    console.error("[stripe] handler error", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

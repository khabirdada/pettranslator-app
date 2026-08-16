// POST /api/billing/checkout
// Body: { interval: "monthly" | "annual" }
// Returns: { url } — the Stripe Checkout Session URL the client redirects to.
//
// Auth: required (must be logged in). The user's email is bound to the
// Stripe Customer; the user's Supabase id is passed as client_reference_id
// so the webhook can map subscription → profile without an extra round-trip.

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getStripe, tierToPriceId } from "@/lib/stripe";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://app.pettranslator.ai";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { tier?: "premium" | "pro"; interval?: "monthly" | "annual" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const tier = body.tier === "pro" ? "pro" : "premium";
  // Both Premium and Pro now have monthly + annual.
  const interval = body.interval === "monthly" ? "monthly" : "annual";
  const priceId = tierToPriceId(tier, interval);
  if (!priceId) {
    return NextResponse.json({ error: "price_not_configured" }, { status: 500 });
  }

  // Reuse an existing Stripe customer for this user if we've created one
  // before — prevents duplicate customer rows in Stripe when the same
  // user starts checkout twice.
  const svc = createServiceClient();
  const referralCode = req.cookies.get("pettranslator_ref")?.value?.toLowerCase();
  const { data: creatorPartner } = referralCode
    ? await svc
        .from("creator_partners")
        .select("id, code")
        .eq("code", referralCode)
        .eq("status", "active")
        .maybeSingle()
    : { data: null };
  const { data: profile } = await svc
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  let customerId = profile?.stripe_customer_id ?? undefined;

  const stripe = getStripe();

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await svc
      .from("profiles")
      .update({ stripe_customer_id: customerId, payment_provider: "stripe" })
      .eq("id", user.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // client_reference_id is the *primary* link from Stripe → our DB
    // for the webhook handler. Customer metadata is the backup.
    client_reference_id: user.id,
    // Stripe Tax handles US sales-tax automatically when enabled in
    // the dashboard. No-op if Tax is off.
    automatic_tax: { enabled: true },
    // Let the customer apply discount codes at checkout (we may run
    // promos via Stripe Coupons later; cheap to enable now).
    allow_promotion_codes: true,
    // Where Stripe redirects after success/cancel.
    success_url: `${APP_URL}/dashboard?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/pricing?upgrade=cancelled`,
    // Subscription-mode niceties
    subscription_data: {
      metadata: {
        supabase_user_id: user.id,
        ...(creatorPartner?.code ? { creator_ref: creatorPartner.code } : {}),
      },
    },
  });

  if (creatorPartner && session.id) {
    const { error: referralError } = await svc.from("creator_referrals").upsert(
      {
        creator_partner_id: creatorPartner.id,
        referred_user_id: user.id,
        stripe_checkout_session_id: session.id,
        status: "checkout_started",
      },
      { onConflict: "creator_partner_id,referred_user_id" },
    );
    if (referralError) {
      console.error("creator_referral_record_failed", referralError.message);
    }
  }

  return NextResponse.json({ url: session.url });
}

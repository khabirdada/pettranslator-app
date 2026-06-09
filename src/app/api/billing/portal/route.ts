// POST /api/billing/portal
// Returns: { url } — the Stripe Billing Portal session URL.
//
// Customer self-serve: update card, cancel subscription, see invoices,
// download receipts. Stripe owns the UI; we just hand them off.

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://app.pettranslator.ai";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.stripe_customer_id) {
    // User has no Stripe customer yet (never subscribed). Surface a
    // friendly error rather than 500 — the client can route them to /pricing.
    return NextResponse.json(
      { error: "no_subscription" },
      { status: 404 },
    );
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${APP_URL}/dashboard`,
  });

  return NextResponse.json({ url: session.url });
}

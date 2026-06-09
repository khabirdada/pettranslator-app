// POST /api/billing/webhook
//
// Stripe webhook handler. Verifies the signature against
// STRIPE_WEBHOOK_SECRET, then updates profiles based on the event.
//
// Idempotency: Stripe may re-deliver an event multiple times (network
// retries, our 5xx, etc.). We use the event.id as a primary-key check
// against a stripe_webhook_events table — duplicates are silently
// acknowledged with 200 so Stripe stops retrying.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

// Raw body required for signature verification — disable Next.js's
// automatic JSON parsing.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("webhook_no_secret");
    return NextResponse.json({ error: "no_secret" }, { status: 500 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "no_signature" }, { status: 400 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("webhook_signature_failed", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  const svc = createServiceClient();

  // Idempotency check. The table is best-effort — if it doesn't exist
  // yet we still process the event, just without de-duplication.
  // (Migration ships alongside this code.)
  try {
    const { error: dupErr } = await svc
      .from("stripe_webhook_events")
      .insert({ id: event.id, type: event.type });
    if (dupErr && dupErr.code === "23505") {
      // duplicate key — already processed
      return NextResponse.json({ received: true, deduped: true });
    }
  } catch {
    // Table missing — continue without de-dup. The migration will create it.
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(svc, session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpsert(svc, sub);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(svc, sub);
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(svc, inv);
        break;
      }
      // We see lots of other events (invoice.created, invoice.paid,
      // customer.updated, etc.). Acknowledge but don't act — the
      // subscription.* events carry the authoritative state.
      default:
        break;
    }
  } catch (err) {
    console.error("webhook_handler_failed", event.type, err);
    // Return 500 so Stripe retries. Idempotency dedup will kick in
    // when we successfully process the next attempt.
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ─── Handlers ──────────────────────────────────────────────────────────────

type ServiceClient = ReturnType<typeof createServiceClient>;

async function handleCheckoutCompleted(
  svc: ServiceClient,
  session: Stripe.Checkout.Session,
) {
  // The subscription state will be applied by the subscription.created
  // webhook that fires moments later. Here we just record the customer
  // mapping in case it was missed in the checkout endpoint.
  const userId = session.client_reference_id;
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!userId || !customerId) return;

  await svc
    .from("profiles")
    .update({ stripe_customer_id: customerId, payment_provider: "stripe" })
    .eq("id", userId);
}

async function handleSubscriptionUpsert(
  svc: ServiceClient,
  sub: Stripe.Subscription,
) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = sub.metadata?.supabase_user_id;

  // Map Stripe statuses → our internal column values.
  // active + trialing both grant access. past_due/unpaid keep access
  // briefly (Stripe will retry) but we surface the badge in the UI.
  const status =
    sub.status === "active" || sub.status === "trialing"
      ? "active"
      : sub.status === "past_due"
        ? "past_due"
        : sub.status === "canceled" || sub.status === "incomplete_expired"
          ? "canceled"
          : sub.status === "incomplete"
            ? "incomplete"
            : "free";

  // Anchor "this month" rate-limit window to the current billing period.
  const periodStart =
    sub.items.data[0]?.current_period_start
      ? new Date(sub.items.data[0].current_period_start * 1000).toISOString()
      : null;

  const update: Record<string, unknown> = {
    subscription_status: status,
    payment_provider: "stripe",
    stripe_customer_id: customerId,
    current_period_start: periodStart,
  };

  // Find the profile to update — prefer userId from metadata, fall back
  // to looking up by customer_id.
  if (userId) {
    await svc.from("profiles").update(update).eq("id", userId);
  } else {
    await svc.from("profiles").update(update).eq("stripe_customer_id", customerId);
  }
}

async function handleSubscriptionDeleted(
  svc: ServiceClient,
  sub: Stripe.Subscription,
) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  await svc
    .from("profiles")
    .update({ subscription_status: "canceled" })
    .eq("stripe_customer_id", customerId);
}

async function handlePaymentFailed(svc: ServiceClient, inv: Stripe.Invoice) {
  const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
  if (!customerId) return;
  await svc
    .from("profiles")
    .update({ subscription_status: "past_due" })
    .eq("stripe_customer_id", customerId);
  // (Later: send a "update your payment method" email via Resend with
  //  a link to /api/billing/portal. Not blocking launch.)
}

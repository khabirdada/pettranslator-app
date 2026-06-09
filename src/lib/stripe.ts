// Stripe client — server-only, LAZY-instantiated singleton.
//
// Lazy because Next.js "Collecting page data" walks every route module
// at build time, and the Stripe constructor throws if there's no API
// key. Routes call `getStripe()` only at request time when the env
// variable is guaranteed to be set in production.
//
// NEVER import this file from a client component — the secret key
// is bound to the closure here.

import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to the Vercel project env.",
    );
  }
  _stripe = new Stripe(key, {
    // Omitting apiVersion uses the account's default — pinned in the
    // Stripe Dashboard. Keeps dashboard + SDK in sync. Bump deliberately
    // by setting both together.
    appInfo: {
      name: "PetTranslator.ai",
      url: "https://app.pettranslator.ai",
    },
    // Auto-retry on network errors with exponential backoff.
    maxNetworkRetries: 2,
  });
  return _stripe;
}

// Price IDs (keep STRIPE_PRICE_MONTHLY/YEARLY names for backward compat;
// they map to Premium). Pro shipped later as a third tier.
export const STRIPE_PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY ?? "";
export const STRIPE_PRICE_YEARLY = process.env.STRIPE_PRICE_YEARLY ?? "";
export const STRIPE_PRICE_PRO_MONTHLY = process.env.STRIPE_PRICE_PRO_MONTHLY ?? "";

/**
 * Maps a Stripe price ID back to the subscription tier we charge for.
 * Webhook uses this to set profiles.subscription_tier on subscription
 * events; checkout uses it to know which price the user just chose.
 *
 * Unknown price IDs return 'free' so a misconfigured webhook can never
 * accidentally grant access to a tier we didn't sell.
 */
export type SubscriptionTier = "free" | "premium" | "pro";
export function priceIdToTier(priceId: string | null | undefined): SubscriptionTier {
  if (!priceId) return "free";
  if (priceId === STRIPE_PRICE_PRO_MONTHLY) return "pro";
  if (priceId === STRIPE_PRICE_MONTHLY || priceId === STRIPE_PRICE_YEARLY) return "premium";
  return "free";
}

export function tierToPriceId(
  tier: "premium" | "pro",
  interval: "monthly" | "annual",
): string {
  if (tier === "pro") return STRIPE_PRICE_PRO_MONTHLY; // monthly only for now
  return interval === "annual" ? STRIPE_PRICE_YEARLY : STRIPE_PRICE_MONTHLY;
}

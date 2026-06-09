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

export const STRIPE_PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY ?? "";
export const STRIPE_PRICE_YEARLY = process.env.STRIPE_PRICE_YEARLY ?? "";

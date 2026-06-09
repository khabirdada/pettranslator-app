"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Locked pricing (June 2026):
//   Free:    3 analyses lifetime
//   Premium: $4.99/mo OR $39.99/yr (33% annual discount), 30 analyses/month
// PayPal Subscriptions wires up later — for now the Premium CTA routes
// to /login so users join the funnel; existing accounts will be the
// first to get Premium when checkout ships.

type BillingInterval = "monthly" | "annual";

const PREMIUM_MONTHLY_USD = 4.99;
const PREMIUM_ANNUAL_USD = 39.99;
const ANNUAL_DISCOUNT_PERCENT = 33; // 39.99/12 = $3.33/mo vs $4.99/mo

export default function PricingPage() {
  const router = useRouter();
  // Annual is PRESELECTED — 30-50% lift on annual conversion per published
  // SaaS pricing experiments. Aligns with the locked pricing decision.
  const [interval, setInterval] = useState<BillingInterval>("annual");
  const [checkoutState, setCheckoutState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; msg: string }
  >({ kind: "idle" });

  // Click handler for "Get Premium →".
  // Calls /api/billing/checkout. If user is signed in → Stripe Checkout URL,
  // redirected immediately. If 401 → route to /login with the intent so we
  // return them to /pricing on success and they can click Premium again.
  async function startCheckout() {
    setCheckoutState({ kind: "loading" });
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
      });
      if (res.status === 401) {
        router.push(`/login?intent=premium&interval=${interval}`);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `checkout_${res.status}`);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.assign(url);
    } catch (err) {
      setCheckoutState({
        kind: "error",
        msg: err instanceof Error ? err.message : "checkout_failed",
      });
    }
  }

  const premiumPrice = interval === "annual" ? PREMIUM_ANNUAL_USD : PREMIUM_MONTHLY_USD;
  const premiumPeriod = interval === "annual" ? "year" : "month";
  const equivalentMonthly = interval === "annual"
    ? (PREMIUM_ANNUAL_USD / 12).toFixed(2)
    : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 sm:py-20">
      {/* Schema.org Offers — server-side rendering of JSON-LD for SEO/AI crawlers */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "PetTranslator.ai",
            applicationCategory: "LifestyleApplication",
            operatingSystem: "Web",
            description:
              "Behavioral analysis for dogs and cats from a single photo. Vet-behaviorist-grade reports in under ten seconds.",
            url: "https://app.pettranslator.ai/pricing",
            offers: [
              {
                "@type": "Offer",
                name: "Free",
                price: "0",
                priceCurrency: "USD",
                description: "3 lifetime behavioral analyses",
              },
              {
                "@type": "Offer",
                name: "Premium Monthly",
                price: PREMIUM_MONTHLY_USD.toFixed(2),
                priceCurrency: "USD",
                description: "30 behavioral analyses per month, billed monthly",
              },
              {
                "@type": "Offer",
                name: "Premium Annual",
                price: PREMIUM_ANNUAL_USD.toFixed(2),
                priceCurrency: "USD",
                description: `30 behavioral analyses per month, billed annually (${ANNUAL_DISCOUNT_PERCENT}% discount)`,
              },
            ],
          }),
        }}
      />

      {/* HEADER */}
      <p className="label mb-3">§ Pricing</p>
      <h1 className="mb-4 text-2xl sm:text-3xl">
        Read your pet, <em className="text-terra">properly</em>.
      </h1>
      <p className="text-slate mb-12 max-w-prose leading-relaxed">
        Start free — 3 behavioral analyses with no signup required. Upgrade when
        you want consistent insight across multiple pets, multiple moments.
      </p>

      {/* BILLING TOGGLE — full-width on mobile, inline on desktop */}
      <div className="mb-10 flex justify-start">
        <div
          role="tablist"
          aria-label="Billing interval"
          className="inline-flex border border-rule rounded-full p-1 bg-paper-light"
        >
          <button
            type="button"
            role="tab"
            aria-selected={interval === "monthly"}
            onClick={() => setInterval("monthly")}
            className={`px-5 py-1.5 rounded-full text-sm font-medium transition ${
              interval === "monthly"
                ? "bg-ink text-paper-light"
                : "text-slate hover:text-ink"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={interval === "annual"}
            onClick={() => setInterval("annual")}
            className={`px-5 py-1.5 rounded-full text-sm font-medium transition flex items-center gap-2 ${
              interval === "annual"
                ? "bg-ink text-paper-light"
                : "text-slate hover:text-ink"
            }`}
          >
            Annual
            <span
              className={`text-xs font-mono ${
                interval === "annual" ? "text-terra" : "text-terra"
              }`}
            >
              Save {ANNUAL_DISCOUNT_PERCENT}%
            </span>
          </button>
        </div>
      </div>

      {/* TWO-COLUMN CARDS — stacked on mobile */}
      <div className="grid sm:grid-cols-2 gap-6 mb-12">
        {/* FREE TIER */}
        <div className="border border-rule rounded-3xl p-7 bg-paper-light flex flex-col">
          <p className="label mb-3">Free</p>
          <div className="mb-6">
            <span className="font-serif text-4xl">$0</span>
            <span className="text-slate text-sm font-mono ml-1">/ forever</span>
          </div>
          <ul className="space-y-3 text-sm mb-8 flex-1">
            {[
              "3 behavioral analyses (lifetime)",
              "Single pet profile",
              "Full biometric reports",
              "30-day result history",
            ].map((feat) => (
              <li key={feat} className="flex items-start gap-2.5">
                <span className="text-terra font-mono text-xs mt-1">✓</span>
                <span className="text-ink">{feat}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/login"
            className="btn btn-light w-full justify-center"
          >
            Start with 3 free →
          </Link>
          <p className="label mt-3 text-xs text-slate-soft">
            No signup required for the first analysis.
          </p>
        </div>

        {/* PREMIUM TIER */}
        <div className="border-2 border-terra rounded-3xl p-7 bg-paper-light flex flex-col relative">
          <span className="absolute -top-3 left-7 inline-flex items-center bg-terra text-paper-light text-xs font-mono uppercase tracking-wider px-3 py-1 rounded-full">
            Premium
          </span>
          <p className="label mb-3">For consistent insight</p>
          <div className="mb-2 flex items-baseline gap-1.5">
            <span className="font-serif text-4xl">
              ${premiumPrice.toFixed(2)}
            </span>
            <span className="text-slate text-sm font-mono">/ {premiumPeriod}</span>
          </div>
          {equivalentMonthly && (
            <p className="text-xs text-slate-soft font-mono mb-6">
              ${equivalentMonthly}/mo equivalent · billed yearly
            </p>
          )}
          {!equivalentMonthly && (
            <p className="text-xs text-slate-soft font-mono mb-6">
              Cancel anytime · no contract
            </p>
          )}
          <ul className="space-y-3 text-sm mb-8 flex-1">
            {[
              "30 behavioral analyses per month",
              "Up to 5 pet profiles",
              "Full biometric reports",
              "Vet-ready PDF exports (coming)",
              "Behavioral trends & journal",
              "Priority analysis queue",
            ].map((feat) => (
              <li key={feat} className="flex items-start gap-2.5">
                <span className="text-terra font-mono text-xs mt-1">✓</span>
                <span className="text-ink">{feat}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={startCheckout}
            disabled={checkoutState.kind === "loading"}
            className="btn w-full justify-center"
          >
            {checkoutState.kind === "loading"
              ? "Opening checkout…"
              : "Get Premium →"}
          </button>
          {checkoutState.kind === "error" && (
            <p className="text-xs text-terra mt-2">
              {checkoutState.msg}. Try again or email{" "}
              <a href="mailto:hello@pettranslator.ai" className="underline">
                hello@pettranslator.ai
              </a>
              .
            </p>
          )}
          <p className="label mt-3 text-xs text-slate-soft">
            Secure checkout by Stripe · cancel any time
          </p>
        </div>
      </div>

      {/* GUARANTEE / FAQ STRIP */}
      <div className="border-t border-rule pt-8 mb-8">
        <p className="label mb-4">§ The fine print</p>
        <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-6 text-sm">
          <div>
            <dt className="font-semibold text-ink mb-1">7-day refund window</dt>
            <dd className="text-slate leading-relaxed">
              Email <a className="text-terra hover:underline" href="mailto:refund@pettranslator.ai">refund@pettranslator.ai</a> within 7 days of your first charge — full refund, no questions.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink mb-1">Cancel anytime</dt>
            <dd className="text-slate leading-relaxed">
              One click in your account. Access continues through the period you've already paid for; no partial refunds for unused time.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink mb-1">Annual is non-refundable after 7 days</dt>
            <dd className="text-slate leading-relaxed">
              Same 7-day window applies. After that you keep full access through the year; no partial refunds.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink mb-1">Your data isn't training material</dt>
            <dd className="text-slate leading-relaxed">
              Anthropic processes your uploads under enterprise privacy terms — content is never used to train AI models. You can wipe everything from your account in one click.
            </dd>
          </div>
        </dl>
      </div>

      {/* FOOTER LINKS */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-soft font-mono">
        <a
          href="https://pettranslator.ai/refund-policy"
          className="hover:text-terra"
        >
          Refund policy
        </a>
        <a href="https://pettranslator.ai/terms" className="hover:text-terra">
          Terms
        </a>
        <a href="https://pettranslator.ai/privacy" className="hover:text-terra">
          Privacy
        </a>
        <a href="mailto:hello@pettranslator.ai" className="hover:text-terra">
          hello@pettranslator.ai
        </a>
      </div>
    </main>
  );
}

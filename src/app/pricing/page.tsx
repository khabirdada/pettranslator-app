"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Locked pricing (June 2026 — Pro tier added):
//   Free:    3 analyses lifetime, 1 pet profile
//   Premium: $4.99/mo OR $39.99/yr (33% annual discount), 30 analyses/mo,
//            5 pet profiles, 10-per-day safety ceiling
//   Pro:     $9.99/mo (monthly only — no annual yet), 75 analyses/mo,
//            15 pet profiles, 25-per-day ceiling, priority queue, vet-PDF
//
// The Premium "interval" toggle picks monthly vs annual on Premium only.
// Pro is monthly-only at this stage; if the user clicks Pro we don't
// pass interval.

type BillingInterval = "monthly" | "annual";
type Tier = "free" | "premium" | "pro";

const PREMIUM_MONTHLY_USD = 4.99;
const PREMIUM_ANNUAL_USD = 39.99;
const PRO_MONTHLY_USD = 9.99;
const PRO_ANNUAL_USD = 79.99;
const ANNUAL_DISCOUNT_PERCENT = 33;

export default function PricingPage() {
  const router = useRouter();
  // Annual is PRESELECTED on Premium — 30-50% lift on annual conversion.
  const [interval, setInterval] = useState<BillingInterval>("annual");
  const [checkoutState, setCheckoutState] = useState<
    | { kind: "idle" }
    | { kind: "loading"; tier: Tier }
    | { kind: "error"; tier: Tier; msg: string }
  >({ kind: "idle" });

  async function startCheckout(tier: "premium" | "pro") {
    setCheckoutState({ kind: "loading", tier });
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, interval }),
      });
      if (res.status === 401) {
        router.push(`/login?intent=${tier}&interval=${interval}`);
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
        tier,
        msg: err instanceof Error ? err.message : "checkout_failed",
      });
    }
  }

  const isLoading = (t: Tier) => checkoutState.kind === "loading" && checkoutState.tier === t;
  const errorFor = (t: Tier) =>
    checkoutState.kind === "error" && checkoutState.tier === t ? checkoutState.msg : null;

  const premiumPrice = interval === "annual" ? PREMIUM_ANNUAL_USD : PREMIUM_MONTHLY_USD;
  const proPrice = interval === "annual" ? PRO_ANNUAL_USD : PRO_MONTHLY_USD;
  const period = interval === "annual" ? "year" : "month";
  const premiumEquivalentMonthly =
    interval === "annual" ? (PREMIUM_ANNUAL_USD / 12).toFixed(2) : null;
  const proEquivalentMonthly =
    interval === "annual" ? (PRO_ANNUAL_USD / 12).toFixed(2) : null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-20">
      {/* Schema.org SoftwareApplication + Offers + FAQPage */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "SoftwareApplication",
                name: "PetTranslator.ai",
                applicationCategory: "LifestyleApplication",
                operatingSystem: "Web",
                description:
                  "AI behavioral analysis for dogs and cats. Vet-behaviorist-grade reports in under ten seconds.",
                url: "https://app.pettranslator.ai/pricing",
                offers: [
                  { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
                  { "@type": "Offer", name: "Premium Monthly", price: "4.99", priceCurrency: "USD" },
                  { "@type": "Offer", name: "Premium Annual", price: "39.99", priceCurrency: "USD" },
                  { "@type": "Offer", name: "Pro Monthly", price: "9.99", priceCurrency: "USD" },
                  { "@type": "Offer", name: "Pro Annual", price: "79.99", priceCurrency: "USD" },
                ],
              },
            ],
          }),
        }}
      />

      <p className="label mb-3">§ Pricing</p>
      <h1 className="mb-4">
        Read your pet, <em className="text-terra">properly</em>.
      </h1>
      <p className="text-slate text-lg max-w-prose mb-10">
        Start free — 3 analyses, no signup. Upgrade to Premium for monthly
        consistency or Pro for power-user volume across the whole household.
      </p>

      {/* INTERVAL TOGGLE — affects BOTH Premium and Pro */}
      <div className="flex justify-center mb-10">
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
              interval === "monthly" ? "bg-ink text-paper-light" : "text-slate hover:text-ink"
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
              interval === "annual" ? "bg-ink text-paper-light" : "text-slate hover:text-ink"
            }`}
          >
            Annual
            <span className="text-xs font-mono text-terra">Save {ANNUAL_DISCOUNT_PERCENT}%</span>
          </button>
        </div>
      </div>

      {/* THREE-CARD GRID — stacks on mobile, side-by-side on sm+ */}
      <div className="grid sm:grid-cols-3 gap-6 mb-12">
        {/* FREE */}
        <div className="border border-rule rounded-3xl p-6 bg-paper-light flex flex-col">
          <p className="label mb-3">Free</p>
          <div className="mb-6">
            <span className="font-serif text-4xl">$0</span>
            <span className="text-slate text-sm font-mono ml-1">/ forever</span>
          </div>
          <ul className="space-y-2.5 text-sm mb-8 flex-1">
            {[
              "3 behavioral analyses (lifetime)",
              "1 pet profile",
              "Full biometric reports",
              "30-day result history",
            ].map((feat) => (
              <li key={feat} className="flex items-start gap-2.5">
                <span className="text-terra font-mono text-xs mt-1">✓</span>
                <span className="text-ink">{feat}</span>
              </li>
            ))}
          </ul>
          <Link href="/login" className="btn btn-light w-full justify-center">
            Start with 3 free →
          </Link>
          <p className="label mt-3 text-xs text-slate-soft">
            No signup required for the first analysis.
          </p>
        </div>

        {/* PREMIUM — recommended */}
        <div className="border-2 border-terra rounded-3xl p-6 bg-paper-light flex flex-col relative">
          <span className="absolute -top-3 left-6 inline-flex items-center bg-terra text-paper-light text-xs font-mono uppercase tracking-wider px-3 py-1 rounded-full">
            Premium
          </span>
          <p className="label mb-3">For consistent insight</p>
          <div className="mb-2 flex items-baseline gap-1.5">
            <span className="font-serif text-4xl">${premiumPrice.toFixed(2)}</span>
            <span className="text-slate text-sm font-mono">/ {period}</span>
          </div>
          {premiumEquivalentMonthly ? (
            <p className="text-xs text-slate-soft font-mono mb-6">
              ${premiumEquivalentMonthly}/mo equivalent · billed yearly
            </p>
          ) : (
            <p className="text-xs text-slate-soft font-mono mb-6">
              Cancel anytime · no contract
            </p>
          )}
          <ul className="space-y-2.5 text-sm mb-8 flex-1">
            {[
              "30 analyses per month",
              "Up to 5 pet profiles",
              "Full biometric reports",
              "Behavioral trends & journal",
            ].map((feat) => (
              <li key={feat} className="flex items-start gap-2.5">
                <span className="text-terra font-mono text-xs mt-1">✓</span>
                <span className="text-ink">{feat}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => startCheckout("premium")}
            disabled={isLoading("premium")}
            className="btn w-full justify-center"
          >
            {isLoading("premium") ? "Opening checkout…" : "Get Premium →"}
          </button>
          {errorFor("premium") && (
            <p className="text-xs text-terra mt-2">
              {errorFor("premium")}.{" "}
              <a href="mailto:hello@pettranslator.ai" className="underline">
                Email support
              </a>
            </p>
          )}
          <p className="label mt-3 text-xs text-slate-soft">
            Secure checkout by Stripe · cancel any time
          </p>
        </div>

        {/* PRO — power-user tier */}
        <div className="border border-rule rounded-3xl p-6 bg-paper-light flex flex-col">
          <p className="label mb-3">Pro</p>
          <div className="mb-2 flex items-baseline gap-1.5">
            <span className="font-serif text-4xl">${proPrice.toFixed(2)}</span>
            <span className="text-slate text-sm font-mono">/ {period}</span>
          </div>
          {proEquivalentMonthly ? (
            <p className="text-xs text-slate-soft font-mono mb-6">
              ${proEquivalentMonthly}/mo equivalent · billed yearly
            </p>
          ) : (
            <p className="text-xs text-slate-soft font-mono mb-6">
              For breeders, multi-pet homes, fosters
            </p>
          )}
          <ul className="space-y-2.5 text-sm mb-8 flex-1">
            {[
              "75 analyses per month",
              "Up to 15 pet profiles",
              "Everything in Premium",
              "Priority analysis queue",
              "Vet-ready PDF exports",
            ].map((feat) => (
              <li key={feat} className="flex items-start gap-2.5">
                <span className="text-terra font-mono text-xs mt-1">✓</span>
                <span className="text-ink">{feat}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => startCheckout("pro")}
            disabled={isLoading("pro")}
            className="btn w-full justify-center"
          >
            {isLoading("pro") ? "Opening checkout…" : "Get Pro →"}
          </button>
          {errorFor("pro") && (
            <p className="text-xs text-terra mt-2">
              {errorFor("pro")}.{" "}
              <a href="mailto:hello@pettranslator.ai" className="underline">
                Email support
              </a>
            </p>
          )}
          <p className="label mt-3 text-xs text-slate-soft">
            Monthly or annual · cancel anytime
          </p>
        </div>
      </div>

      {/* TRUST STRIP */}
      <div className="border-t border-rule pt-8 mb-8">
        <p className="label mb-4">§ The fine print</p>
        <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-6 text-sm">
          <div>
            <dt className="font-semibold text-ink mb-1">7-day refund window</dt>
            <dd className="text-slate leading-relaxed">
              Email{" "}
              <a className="text-terra hover:underline" href="mailto:refund@pettranslator.ai">
                refund@pettranslator.ai
              </a>{" "}
              within 7 days of your first charge — full refund, no questions.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink mb-1">Cancel anytime</dt>
            <dd className="text-slate leading-relaxed">
              One click in your account. Access continues through the period you've already paid for; no partial refunds.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink mb-1">Same AI on every tier</dt>
            <dd className="text-slate leading-relaxed">
              Free, Premium, and Pro use the same Claude Sonnet 4.6 model and the same prompt. The tiers differ in volume, not reasoning quality.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink mb-1">Your data isn't training material</dt>
            <dd className="text-slate leading-relaxed">
              Anthropic processes uploads under enterprise privacy terms — never used to train AI models.
            </dd>
          </div>
        </dl>
      </div>
    </main>
  );
}

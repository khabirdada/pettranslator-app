// One-click unsubscribe landing page.
//
// The token is an HMAC-signed userId (see lib/email/send.ts). If it
// verifies, we flip email_opt_out = true immediately on GET — no
// confirm click required. That's the "one-click" part; every major
// mail client wants this now (RFC 8058 style headers coming next).
//
// If the token is invalid or expired, show a friendly page and offer
// a mailto fallback. Never reveal WHY it failed (bad signature vs.
// expired secret vs. malformed) — that would leak signal to spammers
// probing token space.

import { createServiceClient } from "@/lib/supabase/server";
import { verifyUnsubscribeToken } from "@/lib/email/send";
import Link from "next/link";

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const userId = verifyUnsubscribeToken(decodeURIComponent(token));

  let ok = false;
  if (userId) {
    const svc = createServiceClient();
    const { error } = await svc
      .from("profiles")
      .update({ email_opt_out: true })
      .eq("id", userId);
    ok = !error;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="label mb-4">§ Email preferences</p>
      {ok ? (
        <>
          <h1 className="mb-6">
            You&apos;re <em className="text-terra">unsubscribed</em>.
          </h1>
          <p className="text-slate max-w-prose leading-relaxed mb-6">
            You won&apos;t receive any more onboarding or product emails
            from us. Transactional email (analysis-complete notifications,
            billing receipts, password resets) will still work — those
            aren&apos;t part of what you opted out of.
          </p>
          <p className="text-slate max-w-prose leading-relaxed mb-10">
            If this was a mistake, or if there&apos;s a specific reason
            you unsubscribed we should know about, reply to any past
            email and it lands in the founder&apos;s inbox.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/dashboard" className="btn">
              Back to dashboard
            </Link>
            <a href="mailto:hello@pettranslator.ai" className="btn btn-light">
              Email hello@pettranslator.ai
            </a>
          </div>
        </>
      ) : (
        <>
          <h1 className="mb-6">
            That link <em className="text-terra">didn&apos;t verify</em>.
          </h1>
          <p className="text-slate max-w-prose leading-relaxed mb-6">
            The unsubscribe link is either malformed or expired. If you
            want to opt out of PetTranslator.ai emails, email us directly
            and we&apos;ll do it manually within a day.
          </p>
          <a href="mailto:hello@pettranslator.ai?subject=Unsubscribe" className="btn">
            Email hello@pettranslator.ai
          </a>
        </>
      )}
    </main>
  );
}

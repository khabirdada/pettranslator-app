// Magic-link callback handler. Supabase redirects here after the user clicks
// the email link. We exchange the code for a session, set cookies, then
// redirect to the original destination.
//
// Also handles the FIRST-VISIT welcome email trigger — if this callback
// completes and the user's onboarding_stage is still 0, we fire the
// welcome email inline (Resend + stage bump) so it lands in the user's
// inbox within a few seconds of finishing sign-up, not up to 24 hours
// later on the next cron tick. Failures don't block the redirect.

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { welcomeEmail } from "@/lib/email/onboarding";
import { sendEmail, unsubscribeUrl } from "@/lib/email/send";

// Best-effort: fire the welcome email inline for first-visit users.
// Never throws — a Resend hiccup should NEVER block sign-in.
async function maybeFireWelcome(userId: string, email: string) {
  const svc = createServiceClient();
  // Atomic guard: only send if stage is still 0. The .eq check races
  // safely because Postgres serializes the UPDATE — a second callback
  // for the same user (double-tap on the magic link) sees stage=1 by
  // then and this branch no-ops.
  const { data, error } = await svc
    .from("profiles")
    .update({ onboarding_stage: 1 })
    .eq("id", userId)
    .eq("onboarding_stage", 0)
    .eq("email_opt_out", false)
    .select("id")
    .maybeSingle();
  if (error || !data) return; // Row already advanced, or opted-out, or no row
  try {
    const payload = welcomeEmail({
      greetingName: "",
      unsubscribeUrl: unsubscribeUrl(userId),
    });
    await sendEmail({
      to: email,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      tag: "onboarding-1",
    });
  } catch (e) {
    // Undo the stage bump so tomorrow's cron retries. Rare path —
    // Resend is >99.9% reliable — but the state machine should be
    // eventually consistent even so.
    console.error("welcome_email_failed", e instanceof Error ? e.message : e);
    await svc
      .from("profiles")
      .update({ onboarding_stage: 0 })
      .eq("id", userId);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Fire the welcome email if this is a first-visit user. Don't
      // await it — the redirect should feel instant. The DB check
      // inside prevents duplicates.
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id && user.email) {
        maybeFireWelcome(user.id, user.email).catch(() => {
          /* logged inside */
        });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("auth_callback_failed", error.message);
  }

  // Failure — bounce back to login with an error flag the page can read
  return NextResponse.redirect(`${origin}/login?error=callback_failed`);
}

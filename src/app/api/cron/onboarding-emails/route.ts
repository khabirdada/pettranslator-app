// GET /api/cron/onboarding-emails
//
// Vercel Cron hits this once per day. Picks up users whose next drip
// email is due, sends it via Resend, increments onboarding_stage.
//
// Timing map (matches src/lib/email/onboarding.ts):
//   stage 0 → stage 1 (welcome)    — fires from /auth/callback on first sign-in,
//                                    NOT here. This cron only handles laggards
//                                    who somehow signed up without going through
//                                    the callback (e.g. imported by admin).
//   stage 1 → stage 2 (day 3)      — cron picks up when created_at ≤ now-3d
//   stage 2 → stage 3 (day 7)      — cron picks up when created_at ≤ now-7d
//   stage 3 → stage 4 (day 14)     — cron picks up when created_at ≤ now-14d
//
// Batch cap: 50 emails per run. Keeps the endpoint under Vercel's
// serverless timeout and avoids Resend rate limits. If a run has
// >50 pending, the leftovers roll to tomorrow.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { emailForStage } from "@/lib/email/onboarding";
import { sendEmail, unsubscribeUrl } from "@/lib/email/send";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BATCH_CAP = 50;

// Day offsets keyed by the stage we're ABOUT to send (i.e. current
// stage + 1). Stage 1 = welcome, handled by callback, so cron only
// considers stages 2/3/4.
const DAYS_FOR_NEXT_STAGE: Record<2 | 3 | 4, number> = {
  2: 3,
  3: 7,
  4: 14,
};

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // For each pending stage (2 → 3 → 4), pull the users whose created_at
  // is past the day threshold, cap the total send count at BATCH_CAP.
  const now = new Date();
  const sends: Array<{
    userId: string;
    email: string;
    nextStage: 1 | 2 | 3 | 4;
  }> = [];

  for (const nextStage of [2, 3, 4] as const) {
    if (sends.length >= BATCH_CAP) break;
    const cutoff = new Date(now.getTime() - DAYS_FOR_NEXT_STAGE[nextStage] * 24 * 60 * 60 * 1000);
    const remaining = BATCH_CAP - sends.length;
    const { data, error } = await svc
      .from("profiles")
      .select("id, email, onboarding_stage")
      .eq("onboarding_stage", nextStage - 1)
      .eq("email_opt_out", false)
      .not("email", "is", null)
      .lte("created_at", cutoff.toISOString())
      .order("created_at", { ascending: true })
      .limit(remaining);
    if (error) {
      console.error("onboarding_pick_failed", { nextStage, msg: error.message });
      continue;
    }
    for (const row of data ?? []) {
      if (!row.email) continue;
      sends.push({
        userId: row.id,
        email: row.email,
        nextStage,
      });
    }
  }

  if (sends.length === 0) {
    return NextResponse.json({ sent: 0, message: "no_pending_emails" });
  }

  // Send in parallel with Promise.allSettled so one Resend failure
  // doesn't poison the batch. Each successful send bumps the row's
  // stage. Failed sends log + leave the row alone so tomorrow's cron
  // retries.
  const results = await Promise.allSettled(
    sends.map(async ({ userId, email, nextStage }) => {
      const builder = emailForStage(nextStage);
      const payload = builder({
        greetingName: "",
        unsubscribeUrl: unsubscribeUrl(userId),
      });
      await sendEmail({
        to: email,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        tag: `onboarding-${nextStage}`,
      });
      // Only bump the stage on send success — the API call above
      // throws on failure, so reaching this line means Resend accepted.
      await svc
        .from("profiles")
        .update({ onboarding_stage: nextStage })
        .eq("id", userId);
      return { userId, nextStage };
    }),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.length - succeeded;
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("onboarding_send_failed", { reason: String(r.reason) });
    }
  }

  return NextResponse.json({
    attempted: sends.length,
    succeeded,
    failed,
  });
}

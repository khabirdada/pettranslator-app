// Rate limiting + cost protection per mvp_architecture.md §8.
//
// Three layers of defense:
//   1. TESTER SHORT-CIRCUIT — profiles flagged with is_tester=true (and
//      tester_expires_at NULL or future) bypass the per-user cap entirely.
//      Used for influencer/vet/QA outreach per influencer_brief.md.
//      The global ceiling still applies — testers cannot bring down the site.
//   2. PER-USER DAILY CAP — 3/day for free, 50/day hard ceiling for premium.
//      The 50 cap protects against single-user runaway (one Reddit post can
//      bankrupt unit economics otherwise).
//   3. GLOBAL DAILY CEILING — 2,000/day across all users. Catches viral
//      spikes before they translate to a real Anthropic bill.
//
// Source of truth for usage is the `analyses` table itself. We count rows
// with status IN ('processing','complete','refused') — these all consumed
// (or are currently consuming) Claude credit.
//   - `pending` = AI call hasn't started yet → don't count
//   - `failed`  = our infrastructure bug killed the run → don't count,
//                  user shouldn't be penalized for our errors

import { createServiceClient } from "@/lib/supabase/server";

export const FREE_DAILY_LIMIT = 3;
export const PREMIUM_DAILY_HARD_CAP = 50;
export const GLOBAL_DAILY_CEILING = 2000;

export type RateLimitOptions = {
  /** profiles.is_tester */
  isTester?: boolean;
  /** profiles.tester_expires_at — null/undefined means permanent. */
  testerExpiresAt?: string | null;
};

export type RateLimitVerdict =
  | {
      allowed: true;
      currentCount: number;
      dailyLimit: number;
      tier: "free" | "premium" | "tester";
    }
  | {
      allowed: false;
      reason: "user_daily_cap" | "global_daily_ceiling";
      currentCount: number;
      dailyLimit: number;
      tier: "free" | "premium" | "tester";
      resetsAt: string; // ISO timestamp of next reset (midnight UTC)
      message: string;
    };

/**
 * True when the profile has an active tester flag (not expired).
 */
function isActiveTester(opts?: RateLimitOptions): boolean {
  if (!opts?.isTester) return false;
  if (!opts.testerExpiresAt) return true; // null/undefined = permanent
  return new Date(opts.testerExpiresAt).getTime() > Date.now();
}

/**
 * Returns the ISO timestamp for the next midnight UTC.
 */
function nextResetISO(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
    ),
  );
  return next.toISOString();
}

/**
 * Returns the start of the current UTC day in ISO format.
 */
function startOfTodayUTC(): string {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
  );
  return start.toISOString();
}

/**
 * Check whether the user is allowed to submit another analysis right now.
 * Call this at the top of /api/analyze BEFORE doing any work.
 *
 * `options.isTester` + `options.testerExpiresAt` skip the per-user cap when
 * the profile is flagged as an active tester. The global ceiling still applies.
 */
export async function checkRateLimit(
  userId: string,
  subscriptionStatus: string,
  options?: RateLimitOptions,
): Promise<RateLimitVerdict> {
  const svc = createServiceClient();
  const testerActive = isActiveTester(options);

  const tier: "free" | "premium" | "tester" = testerActive
    ? "tester"
    : subscriptionStatus === "active"
      ? "premium"
      : "free";

  // Testers get the premium hard-cap value as their "limit" for telemetry,
  // but we skip the per-user check below entirely.
  const dailyLimit =
    tier === "free" ? FREE_DAILY_LIMIT : PREMIUM_DAILY_HARD_CAP;
  const todayStart = startOfTodayUTC();

  // 1. Per-user count — skipped for active testers
  let currentCount = 0;
  if (!testerActive) {
    const { count: userCount, error: userErr } = await svc
      .from("analyses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", todayStart)
      .in("status", ["processing", "complete", "refused"]);

    if (userErr) {
      // Fail open — don't block users on infra errors
      console.error("ratelimit_user_count_failed", userErr.message);
      return { allowed: true, currentCount: 0, dailyLimit, tier };
    }

    currentCount = userCount ?? 0;

    if (currentCount >= dailyLimit) {
      return {
        allowed: false,
        reason: "user_daily_cap",
        currentCount,
        dailyLimit,
        tier,
        resetsAt: nextResetISO(),
        message:
          tier === "free"
            ? `You've used all ${dailyLimit} free analyses today. Upgrade to Premium for unlimited.`
            : `You've hit today's safety ceiling of ${dailyLimit} analyses. This resets at midnight UTC. (If you genuinely need more, email hello@pettranslator.ai.)`,
      };
    }
  }

  // 2. Global ceiling — applies to EVERYONE, including testers, to protect
  // against viral spikes that would still hit the AI bill.
  const { count: globalCount, error: globalErr } = await svc
    .from("analyses")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart)
    .in("status", ["processing", "complete", "refused"]);

  if (globalErr) {
    console.error("ratelimit_global_count_failed", globalErr.message);
    return { allowed: true, currentCount, dailyLimit, tier };
  }

  if ((globalCount ?? 0) >= GLOBAL_DAILY_CEILING) {
    return {
      allowed: false,
      reason: "global_daily_ceiling",
      currentCount,
      dailyLimit,
      tier,
      resetsAt: nextResetISO(),
      message:
        "PetTranslator.ai has hit its global daily safety ceiling. We'll be back in a few hours. (This is unusual — sorry for the inconvenience.)",
    };
  }

  return { allowed: true, currentCount, dailyLimit, tier };
}

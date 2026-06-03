// Rate limiting + cost protection per mvp_architecture.md §8.
//
// Two layers of defense:
//   1. PER-USER DAILY CAP — 3/day for free, 50/day hard ceiling for premium.
//      The 50 cap protects against single-user runaway (one Reddit post can
//      bankrupt unit economics otherwise).
//   2. GLOBAL DAILY CEILING — 2,000/day across all users. Catches viral
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

export type RateLimitVerdict =
  | {
      allowed: true;
      currentCount: number;
      dailyLimit: number;
      tier: "free" | "premium";
    }
  | {
      allowed: false;
      reason: "user_daily_cap" | "global_daily_ceiling";
      currentCount: number;
      dailyLimit: number;
      tier: "free" | "premium";
      resetsAt: string; // ISO timestamp of next reset (midnight UTC)
      message: string;
    };

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
 */
export async function checkRateLimit(
  userId: string,
  subscriptionStatus: string,
): Promise<RateLimitVerdict> {
  const svc = createServiceClient();
  const tier: "free" | "premium" =
    subscriptionStatus === "active" ? "premium" : "free";
  const dailyLimit =
    tier === "premium" ? PREMIUM_DAILY_HARD_CAP : FREE_DAILY_LIMIT;
  const todayStart = startOfTodayUTC();

  // 1. Per-user count
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

  const currentCount = userCount ?? 0;

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

  // 2. Global ceiling — only checked if the per-user check passed
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

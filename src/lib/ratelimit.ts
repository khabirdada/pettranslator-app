// Rate limiting + cost protection (v1.2 model — lifetime free + monthly premium).
//
// Pricing model locked June 2026:
//   FREE     — 3 analyses lifetime (no reset).
//   PREMIUM  — 30 analyses per billing period (counted from
//              profiles.current_period_start), with a 10-per-day soft
//              safety ceiling on top to prevent single-day cost spikes.
//   TESTER   — is_tester=true flag (set via grant_tester_access SQL helper)
//              bypasses per-user caps. Used for influencer / vet / QA outreach.
//   GLOBAL   — 2,000/day site-wide ceiling applies to EVERYONE including
//              testers. Catches viral spikes before they translate to a
//              real Anthropic bill.
//
// Source of truth for usage is the `analyses` table itself. We count rows
// with status IN ('processing','complete','refused') — these all consumed
// (or are currently consuming) Claude credit.
//   - `pending` = AI call hasn't started yet → don't count
//   - `failed`  = our infrastructure bug killed the run → don't count
//                 (user shouldn't be penalized for our errors)
//
// Earlier model (v1.0/v1.1): 3/day free + 50/day premium hard cap. Replaced
// here. The legacy usage_daily and anon_usage_daily tables are deprecated
// (still present in DB, no longer read).

import { createServiceClient } from "@/lib/supabase/server";

// Caps (locked pricing, June 2026)
export const FREE_LIFETIME_LIMIT = 3;
export const PREMIUM_MONTHLY_LIMIT = 30;
export const PREMIUM_DAILY_SAFETY_CEILING = 10;
export const GLOBAL_DAILY_CEILING = 2000;

// 30 days = one billing "month" for fallback when current_period_start is
// missing (e.g. legacy active subs that pre-date the column).
const FALLBACK_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export type RateLimitOptions = {
  /** profiles.is_tester */
  isTester?: boolean;
  /** profiles.tester_expires_at — null/undefined means permanent. */
  testerExpiresAt?: string | null;
  /** profiles.current_period_start — ISO string. Set by billing webhook
   *  on each renewal. Fallback: 30 days ago if missing. */
  currentPeriodStart?: string | null;
};

export type RateLimitTier = "free" | "premium" | "tester";

export type RateLimitVerdict =
  | {
      allowed: true;
      currentCount: number;
      cap: number;
      tier: RateLimitTier;
    }
  | {
      allowed: false;
      reason:
        | "free_quota_exhausted"
        | "monthly_limit_reached"
        | "daily_safety_ceiling"
        | "global_daily_ceiling";
      currentCount: number;
      cap: number;
      tier: RateLimitTier;
      /** ISO timestamp. NULL for free tier (no reset — upgrade is the path). */
      resetsAt: string | null;
      message: string;
    };

/**
 * Returns the ISO timestamp for the next midnight UTC.
 */
function nextUtcMidnightISO(): string {
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
function startOfTodayUtcISO(): string {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
  );
  return start.toISOString();
}

/**
 * Returns the ISO timestamp when a billing period ends — exactly 30 days
 * after the supplied current_period_start. Used to render "Resets [date]"
 * in 402 responses.
 */
function periodEndISO(periodStart: string): string {
  const start = new Date(periodStart).getTime();
  return new Date(start + FALLBACK_PERIOD_MS).toISOString();
}

/**
 * Resolves the effective period_start: provided value, or 30 days ago as a
 * fallback for accounts that became Premium before this column existed.
 */
function resolvePeriodStart(provided?: string | null): string {
  if (provided) return provided;
  return new Date(Date.now() - FALLBACK_PERIOD_MS).toISOString();
}

/**
 * True when the profile has an active tester flag (not expired).
 */
function isActiveTester(opts?: RateLimitOptions): boolean {
  if (!opts?.isTester) return false;
  if (!opts.testerExpiresAt) return true; // null/undefined = permanent
  return new Date(opts.testerExpiresAt).getTime() > Date.now();
}

/**
 * Check whether the user is allowed to submit another analysis right now.
 * Call this at the top of /api/analyze BEFORE doing any work.
 *
 * Flow:
 *   1. Active tester? → only global ceiling applies.
 *   2. Premium? → 30/period AND 10/day safety ceiling.
 *   3. Free?   → 3 lifetime.
 *   4. Global ceiling applies to everyone.
 *
 * On infra errors (Supabase failures), we FAIL OPEN — better to let a user
 * through than to break the product over a flaky read.
 */
export async function checkRateLimit(
  userId: string,
  subscriptionStatus: string,
  options?: RateLimitOptions,
): Promise<RateLimitVerdict> {
  const svc = createServiceClient();
  const testerActive = isActiveTester(options);

  const tier: RateLimitTier = testerActive
    ? "tester"
    : subscriptionStatus === "active"
      ? "premium"
      : "free";

  // ─── 1. Tester short-circuit ──────────────────────────────────────────────
  if (testerActive) {
    // Testers skip per-user caps. Global ceiling still applies.
    return runGlobalCheck(svc, tier, /* userCurrentCount */ 0, /* userCap */ PREMIUM_MONTHLY_LIMIT);
  }

  // ─── 2. Premium tier checks ───────────────────────────────────────────────
  if (tier === "premium") {
    const periodStart = resolvePeriodStart(options?.currentPeriodStart);

    // 2a. Period cap (30 analyses since current_period_start)
    const { count: periodCount, error: periodErr } = await svc
      .from("analyses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", periodStart)
      .in("status", ["processing", "complete", "refused"]);

    if (periodErr) {
      console.error("ratelimit_period_count_failed", periodErr.message);
      return { allowed: true, currentCount: 0, cap: PREMIUM_MONTHLY_LIMIT, tier };
    }

    const usedThisPeriod = periodCount ?? 0;
    if (usedThisPeriod >= PREMIUM_MONTHLY_LIMIT) {
      return {
        allowed: false,
        reason: "monthly_limit_reached",
        currentCount: usedThisPeriod,
        cap: PREMIUM_MONTHLY_LIMIT,
        tier,
        resetsAt: periodEndISO(periodStart),
        message: `You've used all ${PREMIUM_MONTHLY_LIMIT} analyses this period. Your quota resets on the next billing renewal.`,
      };
    }

    // 2b. Daily safety ceiling (10/day) — prevents single-day cost spikes
    const todayStart = startOfTodayUtcISO();
    const { count: todayCount, error: todayErr } = await svc
      .from("analyses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", todayStart)
      .in("status", ["processing", "complete", "refused"]);

    if (todayErr) {
      console.error("ratelimit_today_count_failed", todayErr.message);
      // Fall through — we already validated the period cap
    } else if ((todayCount ?? 0) >= PREMIUM_DAILY_SAFETY_CEILING) {
      return {
        allowed: false,
        reason: "daily_safety_ceiling",
        currentCount: todayCount ?? 0,
        cap: PREMIUM_DAILY_SAFETY_CEILING,
        tier,
        resetsAt: nextUtcMidnightISO(),
        message: `You've used ${todayCount} of your ${PREMIUM_MONTHLY_LIMIT} monthly analyses today — that's your daily safety limit (${PREMIUM_DAILY_SAFETY_CEILING}/day). Resets at midnight UTC.`,
      };
    }

    // Premium passes per-user checks — fall through to global ceiling
    return runGlobalCheck(svc, tier, usedThisPeriod, PREMIUM_MONTHLY_LIMIT);
  }

  // ─── 3. Free tier checks (3 lifetime) ─────────────────────────────────────
  const { count: lifetimeCount, error: lifeErr } = await svc
    .from("analyses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["processing", "complete", "refused"]);

  if (lifeErr) {
    console.error("ratelimit_lifetime_count_failed", lifeErr.message);
    return { allowed: true, currentCount: 0, cap: FREE_LIFETIME_LIMIT, tier };
  }

  const usedLifetime = lifetimeCount ?? 0;
  if (usedLifetime >= FREE_LIFETIME_LIMIT) {
    return {
      allowed: false,
      reason: "free_quota_exhausted",
      currentCount: usedLifetime,
      cap: FREE_LIFETIME_LIMIT,
      tier,
      resetsAt: null, // no reset — upgrade is the only path forward
      message: `You've used all ${FREE_LIFETIME_LIMIT} free analyses. Upgrade to Premium for ${PREMIUM_MONTHLY_LIMIT} per month, $4.99/mo or $39.99/yr.`,
    };
  }

  return runGlobalCheck(svc, tier, usedLifetime, FREE_LIFETIME_LIMIT);
}

/**
 * Global daily ceiling check — applies to everyone including testers, to
 * cap total Anthropic spend on a viral-spike day.
 */
async function runGlobalCheck(
  svc: ReturnType<typeof createServiceClient>,
  tier: RateLimitTier,
  currentCount: number,
  cap: number,
): Promise<RateLimitVerdict> {
  const todayStart = startOfTodayUtcISO();
  const { count: globalCount, error: globalErr } = await svc
    .from("analyses")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart)
    .in("status", ["processing", "complete", "refused"]);

  if (globalErr) {
    console.error("ratelimit_global_count_failed", globalErr.message);
    return { allowed: true, currentCount, cap, tier };
  }

  if ((globalCount ?? 0) >= GLOBAL_DAILY_CEILING) {
    return {
      allowed: false,
      reason: "global_daily_ceiling",
      currentCount,
      cap,
      tier,
      resetsAt: nextUtcMidnightISO(),
      message:
        "PetTranslator.ai has hit its global daily safety ceiling. We'll be back in a few hours. (This is unusual — sorry for the inconvenience.)",
    };
  }

  return { allowed: true, currentCount, cap, tier };
}

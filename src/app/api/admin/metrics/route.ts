// GET /api/admin/metrics
//
// One endpoint that answers "how is the product actually doing" without
// needing the Supabase dashboard. Built because the dashboard's SQL
// editor is a heavy client-side app that intermittently fails to mount
// under automation, which made routine metric checks unreliable.
//
// Auth: a shared secret in ADMIN_METRICS_KEY. Send it either as
//   Authorization: Bearer <key>          (preferred — not written to access logs)
//   ?key=<key>                           (convenient for curl; DOES appear in logs)
//
// Compared with a timing-safe equality check. Returns 401 on mismatch.
// If ADMIN_METRICS_KEY is unset the route refuses all traffic rather
// than defaulting open.
//
// Privacy: deliberately returns NO personally identifying data — no
// emails, no names, no user IDs, no pet names, no analysis content.
// Counts, rates, dates, and failure codes only. That way a leaked key
// exposes business metrics, not user data.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so compare lengths first
  // (length is not the secret — the content is).
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type Svc = ReturnType<typeof createServiceClient>;

// Supabase count helper — head:true means no rows come back over the wire.
//
// `since` is an ISO timestamp; when present the count is restricted to rows
// created at or after it. This started life as a generic `apply` callback,
// but .select() and .gte() return different builder types, so the callback
// could not be typed without threading four generics through for no runtime
// benefit. Every caller only ever wanted "count rows since date", so the
// narrower parameter is both simpler and type-correct.
async function countRows(
  svc: Svc,
  table: string,
  since?: string,
): Promise<number> {
  let q = svc.from(table).select("*", { count: "exact", head: true });
  if (since) q = q.gte("created_at", since);
  const { count, error } = await q;
  if (error) {
    console.error("metrics_count_failed", { table, message: error.message });
    return -1; // -1 signals "query errored" rather than silently reading as zero
  }
  return count ?? 0;
}

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

export async function GET(req: NextRequest) {
  const expected = process.env.ADMIN_METRICS_KEY;
  if (!expected) {
    console.error("admin_metrics_key_unset");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = req.nextUrl.searchParams.get("key") ?? "";
  const supplied = bearer || query;

  if (!supplied || !safeEqual(supplied, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // Row-level pulls. At current scale (tens of rows) fetching and
  // aggregating in JS is cheaper than a round-trip per bucket. Revisit
  // with a Postgres RPC once analyses passes a few thousand rows.
  const [
    { data: profiles, error: pErr },
    { data: analyses, error: aErr },
    petCount,
    userCount,
    users24h,
    users7d,
    users30d,
  ] = await Promise.all([
    svc
      .from("profiles")
      .select("subscription_status, subscription_tier, is_tester, onboarding_stage, email_opt_out, lifetime_analyses_used, created_at"),
    svc
      .from("analyses")
      .select("status, refusal_code, failure_reason, duration_ms, inference_cost_usd, pet_id, frame_paths, created_at")
      .order("created_at", { ascending: false })
      .limit(2000),
    countRows(svc, "pet_profiles"),
    countRows(svc, "profiles"),
    countRows(svc, "profiles", iso(1)),
    countRows(svc, "profiles", iso(7)),
    countRows(svc, "profiles", iso(30)),
  ]);

  if (pErr || aErr) {
    console.error("metrics_fetch_failed", { p: pErr?.message, a: aErr?.message });
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }

  const P = profiles ?? [];
  const A = analyses ?? [];

  // ---- subscriptions ----
  const active = P.filter((r) => r.subscription_status === "active");
  const subs = {
    active: active.length,
    premium: active.filter((r) => r.subscription_tier === "premium").length,
    pro: active.filter((r) => r.subscription_tier === "pro").length,
    past_due: P.filter((r) => r.subscription_status === "past_due").length,
    canceled: P.filter((r) => r.subscription_status === "canceled").length,
    free: P.filter((r) => !r.subscription_status || r.subscription_status === "free").length,
    testers: P.filter((r) => r.is_tester).length,
  };
  // MRR in dollars, from live price points. Annual plans bill yearly but
  // are normalised to a monthly figure here so the number is comparable.
  const mrr = subs.premium * 4.99 + subs.pro * 9.99;

  // ---- analyses ----
  const byStatus = A.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const complete = byStatus.complete ?? 0;
  const refused = byStatus.refused ?? 0;
  const failed = byStatus.failed ?? 0;
  const terminal = complete + refused + failed;

  const refusalCodes = A.filter((r) => r.refusal_code).reduce<Record<string, number>>((acc, r) => {
    acc[r.refusal_code as string] = (acc[r.refusal_code as string] ?? 0) + 1;
    return acc;
  }, {});

  // Failure reasons, newest first. This is the column added in migration
  // 0008 precisely so failures stop being undiagnosable.
  const failures = A.filter((r) => r.status === "failed").map((r) => ({
    reason: r.failure_reason ?? null,
    at: r.created_at,
  }));
  const undiagnosed = failures.filter((f) => !f.reason).length;

  const durations = A.filter((r) => r.status === "complete" && r.duration_ms)
    .map((r) => r.duration_ms as number)
    .sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;

  const spend = A.reduce((s, r) => s + (Number(r.inference_cost_usd) || 0), 0);

  // ---- onboarding drip ----
  // onboarding_stage: 0 = nothing sent, 1..4 = which drip email last went out.
  const stages = P.reduce<Record<string, number>>((acc, r) => {
    const k = String(r.onboarding_stage ?? 0);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    users: {
      total: userCount,
      new_24h: users24h,
      new_7d: users7d,
      new_30d: users30d,
    },
    subscriptions: { ...subs, mrr_usd: Number(mrr.toFixed(2)) },
    analyses: {
      total: A.length,
      by_status: byStatus,
      completion_rate_pct: terminal ? Number(((complete / terminal) * 100).toFixed(1)) : null,
      // Refusals are correct behaviour, not errors — this rate excludes
      // them so it reflects genuine pipeline health.
      success_excluding_refusals_pct:
        complete + failed ? Number(((complete / (complete + failed)) * 100).toFixed(1)) : null,
      refusal_codes: refusalCodes,
      video_analyses: A.filter((r) => Array.isArray(r.frame_paths) && r.frame_paths.length > 1).length,
      tagged_to_a_pet: A.filter((r) => r.pet_id).length,
      median_duration_ms: median,
      total_inference_spend_usd: Number(spend.toFixed(4)),
    },
    failures: {
      count: failures.length,
      undiagnosed,
      recent: failures.slice(0, 10),
    },
    pets: {
      profiles: petCount,
      users_with_at_least_one: new Set(A.filter((r) => r.pet_id).map((r) => r.pet_id)).size,
    },
    onboarding: {
      by_stage: stages,
      received_at_least_one_email: P.filter((r) => (r.onboarding_stage ?? 0) > 0).length,
      opted_out: P.filter((r) => r.email_opt_out).length,
    },
  });
}

// POST /api/analyze
//
// User has uploaded an image to Supabase Storage. This route synchronously:
//   1. Validates auth + the storage path
//   2. Creates the analyses row (status=processing)
//   3. Signs a 5-min read URL for the upload
//   4. Calls Claude — typically 6–15s
//   5. Persists the result + completes the row
//   6. Returns the analysis id (client redirects to /analysis/[id] which
//      already shows the complete result on first poll)
//
// We deliberately run synchronously instead of fire-and-forget because
// Vercel kills background promises after the response. The Cron at
// /api/cron/process-jobs stays in place as a safety-net sweeper for
// orphaned/failed jobs but isn't on the hot path.

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { PROMPT_VERSION } from "@/lib/ai/prompt";
import { ACTIVE_MODEL, analyzeImage } from "@/lib/ai/analyze";
import { checkRateLimit } from "@/lib/ratelimit";

export const maxDuration = 60; // Vercel Hobby supports up to 60s; analysis ≤30s

const MAX_CONTEXT_LEN = 240;
const SIGNED_URL_TTL_SECS = 300;

// Truncate + trim before writing failure_reason so the DB check
// constraint (<= 500 chars) can never trip. Error messages from
// third-party SDKs occasionally include stack fragments.
function packFailureReason(stage: string, detail: unknown): string {
  const raw = detail instanceof Error ? detail.message : String(detail ?? "");
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, 480 - stage.length);
  return cleaned ? `${stage}: ${cleaned}` : stage;
}

// Centralized failure marker. Keeps the console + DB writes in
// lockstep so we never again get a "failed" row with no diagnostic.
async function markFailed(
  svc: ReturnType<typeof createServiceClient>,
  analysisId: string,
  stage: string,
  detail: unknown,
) {
  const reason = packFailureReason(stage, detail);
  console.error("analyze_failed", { analysisId, stage, detail: String(detail) });
  await svc
    .from("analyses")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", analysisId);
  return reason;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    storagePath?: string;
    framePaths?: string[];
    userContext?: string;
    petId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Accept EITHER:
  //   storagePath: "<userId>/<uuid>.jpg"                  → single-image
  //   framePaths:  ["<userId>/<uuid>/frame-01.jpg", ...]  → video (N frames)
  const framePaths = Array.isArray(body.framePaths)
    ? body.framePaths.map((p) => String(p).trim()).filter(Boolean)
    : [];
  const singlePath = String(body.storagePath || "").trim();
  const allPaths = framePaths.length > 0 ? framePaths : [singlePath].filter(Boolean);
  const userContext = String(body.userContext || "").slice(0, MAX_CONTEXT_LEN);
  const petId = body.petId ? String(body.petId) : null;

  if (allPaths.length === 0) {
    return NextResponse.json({ error: "missing_storage_path" }, { status: 400 });
  }
  if (allPaths.length > 8) {
    return NextResponse.json({ error: "too_many_frames" }, { status: 400 });
  }
  // Every path must be scoped to this user (paths are <userId>/...)
  for (const p of allPaths) {
    if (!p.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: "invalid_storage_path" }, { status: 400 });
    }
  }

  const svc = createServiceClient();

  // Rate-limit check — 3-tier model: 3 lifetime free / 30 per period premium /
  // 75 per period pro. Also fetch tester flags (testers bypass per-user caps),
  // current_period_start (anchors the "this month" window), and
  // subscription_tier (distinguishes Premium from Pro caps).
  const { data: profile } = await svc
    .from("profiles")
    .select(
      "subscription_status, subscription_tier, is_tester, tester_expires_at, current_period_start",
    )
    .eq("id", user.id)
    .maybeSingle();
  const subStatus = profile?.subscription_status ?? "free";

  const rl = await checkRateLimit(user.id, subStatus, {
    isTester: profile?.is_tester ?? false,
    testerExpiresAt: profile?.tester_expires_at ?? null,
    currentPeriodStart: profile?.current_period_start ?? null,
    subscriptionTier: profile?.subscription_tier ?? null,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: rl.reason,
        message: rl.message,
        tier: rl.tier,
        cap: rl.cap,
        currentCount: rl.currentCount,
        resetsAt: rl.resetsAt,
        // Free-tier exhaustion AND monthly cap both route to /pricing
        // (the latter for future Power-tier upsell).
        upgradeUrl:
          rl.tier === "free" || rl.reason === "monthly_limit_reached"
            ? "/pricing"
            : null,
      },
      { status: 402 },
    );
  }

  // 1. Insert the analyses row (status = processing). For single-image:
  //    storage_path is set, frame_paths is NULL. For video: frame_paths
  //    is set, storage_path is the FIRST frame for backward-compat with
  //    any UI that still reads storage_path.
  //
  // processing_priority: stamped per-tier so the cron sweeper (and any
  // future async queue) drains paid users first. Lower = higher priority.
  const isVideo = framePaths.length > 0;
  const priority =
    profile?.is_tester
      ? 50
      : subStatus === "active" && profile?.subscription_tier === "pro"
        ? 10
        : subStatus === "active"
          ? 50
          : 100;
  const { data: analysis, error: insErr } = await svc
    .from("analyses")
    .insert({
      user_id: user.id,
      pet_id: petId,
      storage_path: allPaths[0],
      frame_paths: isVideo ? framePaths : null,
      user_context: userContext,
      status: "processing",
      prompt_version: PROMPT_VERSION,
      model: ACTIVE_MODEL,
      processing_priority: priority,
    })
    .select("id")
    .single();

  if (insErr || !analysis) {
    console.error("analyses_insert_failed", insErr?.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  // 2. Optional: enrich with pet profile
  let petProfile: { species?: string; approximate_age?: string; breed?: string } | null = null;
  if (petId) {
    const { data: pet } = await svc
      .from("pet_profiles")
      .select("species, approximate_age, breed")
      .eq("id", petId)
      .maybeSingle();
    if (pet) petProfile = pet;
  }

  // 3. Sign short-lived read URLs (one per path) so Claude can fetch
  //    every frame in parallel.
  const signedResults = await Promise.all(
    allPaths.map((p) =>
      svc.storage.from("videos").createSignedUrl(p, SIGNED_URL_TTL_SECS),
    ),
  );
  const signedFailed = signedResults.find((r) => r.error || !r.data);
  if (signedFailed) {
    await markFailed(svc, analysis.id, "signed_url_failed", signedFailed.error?.message);
    return NextResponse.json(
      { error: "signed_url_failed", analysisId: analysis.id },
      { status: 500 },
    );
  }
  const imageUrls = signedResults.map((r) => r.data!.signedUrl);

  // 4. Call Claude — single-image and multi-frame share the same code path.
  // Wrap in try/catch so uncaught throws (Anthropic SDK network errors,
  // JSON schema parse failures, etc.) get diagnostic-tagged instead of
  // leaving the row stuck in "processing" with no explanation.
  let result: Awaited<ReturnType<typeof analyzeImage>>;
  try {
    result = await analyzeImage({ imageUrls, userContext, petProfile });
  } catch (err) {
    await markFailed(svc, analysis.id, "analyze_threw", err);
    return NextResponse.json(
      { error: "analyze_threw", analysisId: analysis.id },
      { status: 500 },
    );
  }

  if (!result.ok) {
    await markFailed(svc, analysis.id, "analyze_failed", result.error);
    return NextResponse.json({ error: result.error, analysisId: analysis.id }, { status: 500 });
  }

  // 5. Persist result
  const output = result.output;
  const updates =
    output.result_type === "refusal"
      ? { status: "refused" as const, refusal_code: output.refusal_code }
      : { status: "complete" as const, refusal_code: null };

  await svc
    .from("analyses")
    .update({
      ...updates,
      result_json: output,
      model: result.model,
      prompt_version: result.prompt_version,
      inference_cost_usd: result.cost_usd,
      duration_ms: result.duration_ms,
      completed_at: new Date().toISOString(),
    })
    .eq("id", analysis.id);

  return NextResponse.json({ analysisId: analysis.id });
}

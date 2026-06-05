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

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { storagePath?: string; userContext?: string; petId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const storagePath = String(body.storagePath || "").trim();
  const userContext = String(body.userContext || "").slice(0, MAX_CONTEXT_LEN);
  const petId = body.petId ? String(body.petId) : null;

  // Storage path must be scoped to this user (paths are <userId>/<uuid>.<ext>)
  if (!storagePath.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: "invalid_storage_path" }, { status: 400 });
  }

  const svc = createServiceClient();

  // Rate-limit check (per-user daily cap + global ceiling)
  // Also fetch tester flags — testers bypass the per-user cap.
  const { data: profile } = await svc
    .from("profiles")
    .select("subscription_status, is_tester, tester_expires_at")
    .eq("id", user.id)
    .maybeSingle();
  const subStatus = profile?.subscription_status ?? "free";

  const rl = await checkRateLimit(user.id, subStatus, {
    isTester: profile?.is_tester ?? false,
    testerExpiresAt: profile?.tester_expires_at ?? null,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: rl.reason,
        message: rl.message,
        tier: rl.tier,
        dailyLimit: rl.dailyLimit,
        currentCount: rl.currentCount,
        resetsAt: rl.resetsAt,
        upgradeUrl: rl.tier === "free" ? "/pricing" : null,
      },
      { status: 402 },
    );
  }

  // 1. Insert the analyses row (status = processing)
  const { data: analysis, error: insErr } = await svc
    .from("analyses")
    .insert({
      user_id: user.id,
      pet_id: petId,
      storage_path: storagePath,
      user_context: userContext,
      status: "processing",
      prompt_version: PROMPT_VERSION,
      model: ACTIVE_MODEL,
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

  // 3. Sign a short-lived read URL so Claude can fetch the image
  const { data: signed, error: sErr } = await svc.storage
    .from("videos")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECS);

  if (sErr || !signed) {
    console.error("signed_url_failed", sErr?.message);
    await svc.from("analyses").update({ status: "failed" }).eq("id", analysis.id);
    return NextResponse.json({ error: "signed_url_failed", analysisId: analysis.id }, { status: 500 });
  }

  // 4. Call Claude
  const result = await analyzeImage({
    imageUrl: signed.signedUrl,
    userContext,
    petProfile,
  });

  if (!result.ok) {
    console.error("analyze_failed", result.error);
    await svc.from("analyses").update({ status: "failed" }).eq("id", analysis.id);
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

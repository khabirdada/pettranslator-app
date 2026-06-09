// GET /api/cron/process-jobs
// Vercel Cron hits this every minute. Also called on-demand from /api/analyze
// right after enqueue so users don't wait up to 60s for the next tick.
//
// Picks up to 3 queued jobs, generates a 5-minute signed read URL for the
// uploaded image, calls Claude via the AI lib, writes result back to the
// analyses row, marks the job done. On failure, increments attempts and
// marks dead after 3 tries.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeImage } from "@/lib/ai/analyze";

export const maxDuration = 300; // Vercel Pro plan: up to 5 minutes
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 3;
const SIGNED_URL_TTL_SECS = 300;
const PICK_BATCH = 3;

export async function GET(req: Request) {
  // Auth — only Vercel Cron or our own /api/analyze should hit this
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // Atomically claim up to PICK_BATCH queued jobs by flipping status to in_flight
  const { data: jobs, error: pickErr } = await svc
    .from("analysis_jobs")
    .update({ status: "in_flight", picked_at: new Date().toISOString() })
    .eq("status", "queued")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(PICK_BATCH)
    .select("id, analysis_id, attempts");

  if (pickErr) {
    console.error("pick_jobs_failed", pickErr.message);
    return NextResponse.json({ error: "pick_failed" }, { status: 500 });
  }

  const picked = jobs ?? [];
  if (picked.length === 0) {
    return NextResponse.json({ processed: 0, message: "no_queued_jobs" });
  }

  // Process all picked jobs in parallel (Promise.allSettled so one failure
  // doesn't poison the others).
  const results = await Promise.allSettled(picked.map(processJob));
  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.length - succeeded;

  return NextResponse.json({ processed: picked.length, succeeded, failed });
}

async function processJob(job: { id: string; analysis_id: string; attempts: number }) {
  const svc = createServiceClient();

  // Fetch the analysis row. frame_paths is the new column for video
  // analyses (0006_frame_paths.sql); old image-only analyses leave it
  // null and the code falls back to storage_path.
  const { data: analysis, error: aErr } = await svc
    .from("analyses")
    .select("id, storage_path, frame_paths, user_context, pet_id")
    .eq("id", job.analysis_id)
    .single();

  if (aErr || !analysis) {
    await markJobDead(job.id, `analysis_not_found: ${aErr?.message}`);
    return;
  }

  // Mark analysis as processing
  await svc
    .from("analyses")
    .update({ status: "processing" })
    .eq("id", analysis.id);

  // Optionally enrich with pet profile
  let petProfile: { species?: string; approximate_age?: string; breed?: string } | null = null;
  if (analysis.pet_id) {
    const { data: pet } = await svc
      .from("pet_profiles")
      .select("species, approximate_age, breed")
      .eq("id", analysis.pet_id)
      .maybeSingle();
    if (pet) petProfile = pet;
  }

  // Generate short-lived signed URLs for Claude to fetch the image(s).
  // Multi-frame video analyses store paths in frame_paths; legacy single
  // images use storage_path.
  const paths: string[] = (analysis.frame_paths && analysis.frame_paths.length > 0)
    ? analysis.frame_paths
    : [analysis.storage_path];
  const signedResults = await Promise.all(
    paths.map((p) =>
      svc.storage.from("videos").createSignedUrl(p, SIGNED_URL_TTL_SECS),
    ),
  );
  const failed = signedResults.find((r) => r.error || !r.data);
  if (failed) {
    await retryOrDie(job, `signed_url_failed: ${failed.error?.message}`);
    return;
  }
  const imageUrls = signedResults.map((r) => r.data!.signedUrl);

  // Call the AI — single-image and multi-frame share the same code path
  const result = await analyzeImage({
    imageUrls,
    userContext: analysis.user_context ?? "",
    petProfile,
  });

  if (!result.ok) {
    await retryOrDie(job, `analyze_failed: ${result.error}`);
    return;
  }

  // Persist the result
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

  await svc
    .from("analysis_jobs")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", job.id);
}

async function retryOrDie(
  job: { id: string; attempts: number },
  errMsg: string,
) {
  const svc = createServiceClient();
  const newAttempts = job.attempts + 1;
  if (newAttempts >= MAX_ATTEMPTS) {
    await svc
      .from("analysis_jobs")
      .update({ status: "dead", attempts: newAttempts, last_error: errMsg })
      .eq("id", job.id);
    // Also flip the analyses row to failed so the UI can show a real state
    const { data } = await svc.from("analysis_jobs").select("analysis_id").eq("id", job.id).single();
    if (data) {
      await svc.from("analyses").update({ status: "failed" }).eq("id", data.analysis_id);
    }
  } else {
    // Bump attempts, put back into queued state for next tick to retry
    await svc
      .from("analysis_jobs")
      .update({ status: "queued", attempts: newAttempts, last_error: errMsg })
      .eq("id", job.id);
  }
}

async function markJobDead(jobId: string, errMsg: string) {
  const svc = createServiceClient();
  await svc
    .from("analysis_jobs")
    .update({ status: "dead", last_error: errMsg })
    .eq("id", jobId);
}

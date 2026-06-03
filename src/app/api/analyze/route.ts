// POST /api/analyze
// User has uploaded an image to Supabase Storage. This route:
//   1. Validates the user has a session
//   2. Validates the upload exists at the claimed storagePath
//   3. Creates an `analyses` row (status=pending) + an `analysis_jobs` row
//   4. Returns the analysis id so the client can poll /api/analysis/[id]
// The actual AI call happens in /api/cron/process-jobs.

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { PROMPT_VERSION } from "@/lib/ai/prompt";
import { ACTIVE_MODEL } from "@/lib/ai/analyze";

const MAX_CONTEXT_LEN = 240;

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

  // Insert the analysis row
  const { data: analysis, error: insErr } = await svc
    .from("analyses")
    .insert({
      user_id: user.id,
      pet_id: petId,
      storage_path: storagePath,
      user_context: userContext,
      status: "pending",
      prompt_version: PROMPT_VERSION,
      model: ACTIVE_MODEL,
    })
    .select("id")
    .single();

  if (insErr || !analysis) {
    console.error("analyses_insert_failed", insErr?.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  // Enqueue the job
  const { error: jobErr } = await svc
    .from("analysis_jobs")
    .insert({ analysis_id: analysis.id, status: "queued" });

  if (jobErr) {
    console.error("job_enqueue_failed", jobErr.message);
    return NextResponse.json({ error: "queue_failed", analysisId: analysis.id }, { status: 500 });
  }

  // Fire-and-forget kick the processor so it runs immediately rather than
  // waiting for the next cron tick.
  const origin = new URL(req.url).origin;
  fetch(`${origin}/api/cron/process-jobs`, {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  }).catch((err) => console.error("kick_processor_failed", err?.message));

  return NextResponse.json({ analysisId: analysis.id });
}

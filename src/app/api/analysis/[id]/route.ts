// GET /api/analysis/[id]
// Polled by the /analysis/[id] page while waiting for the worker to finish.
// Returns the analysis row (status + result_json once complete) for the
// requesting user only. RLS enforces the user_id match at the DB layer too.
//
// Also returns:
//   - imageUrl: a fresh 5-min signed URL for the analyzed photo (first
//     frame for video). The result page uses this to show the source
//     image in a sticky evidence rail beside the report.
//   - pet:     { name, species, breed, approximate_age } when the
//     analysis was associated with a pet profile. Surfaced in the
//     report masthead and evidence rail.

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const SIGNED_URL_TTL_SECS = 300; // 5 minutes — matches the polling lifespan

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params; // Next.js 16 — params is async

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fetch the analysis + the user's tier in parallel. Tier feeds the
  // `canExportPdf` flag the client uses to gate the "Download vet-ready
  // PDF" button on the result page. Doing it here avoids a second
  // roundtrip and keeps the client polling logic simple.
  const [{ data, error }, { data: profile }] = await Promise.all([
    supabase
      .from("analyses")
      .select(
        "id, status, result_json, refusal_code, model, prompt_version, duration_ms, created_at, completed_at, storage_path, frame_paths, pet_id, user_context",
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("subscription_status, is_tester, tester_expires_at")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (error) {
    console.error("analyses_select_failed", error.message);
    return NextResponse.json({ error: "select_failed" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // PDF export gate: active subscription OR active tester only.
  // The /api/analysis/[id]/pdf route enforces the same rule server-side
  // (defense in depth) — this flag is purely UI affordance.
  const now = new Date();
  const testerActive =
    !!profile?.is_tester &&
    (!profile?.tester_expires_at || new Date(profile.tester_expires_at) > now);
  const canExportPdf =
    (profile?.subscription_status === "active" || testerActive) &&
    data.status === "complete";

  // Signed URL for the analyzed image (first frame for video). 5-min TTL,
  // re-minted on every poll — long enough for the user to view the page
  // and download a PDF, short enough not to leak. Uses the service-role
  // client because RLS only governs DB rows, not storage signing.
  const primaryPath = data.storage_path ?? data.frame_paths?.[0] ?? null;
  let imageUrl: string | null = null;
  const isVideo = Array.isArray(data.frame_paths) && data.frame_paths.length > 1;
  if (primaryPath) {
    try {
      const svc = createServiceClient();
      const { data: signed } = await svc
        .storage
        .from("videos")
        .createSignedUrl(primaryPath, SIGNED_URL_TTL_SECS);
      imageUrl = signed?.signedUrl ?? null;
    } catch {
      // Non-fatal — page just renders without the photo if signing fails
      imageUrl = null;
    }
  }

  // Pet metadata when associated. Skipped for analyses without pet_id.
  type PetMeta = {
    name: string;
    species: string;
    breed: string | null;
    approximate_age: string | null;
  };
  let pet: PetMeta | null = null;
  if (data.pet_id) {
    const { data: petRow } = await supabase
      .from("pet_profiles")
      .select("name, species, breed, approximate_age")
      .eq("id", data.pet_id)
      .maybeSingle();
    if (petRow) pet = petRow as PetMeta;
  }

  // Strip storage_path / frame_paths / pet_id from the wire — the client
  // never needs the raw paths, only the signed URL we just minted.
  const { storage_path, frame_paths, pet_id, ...rest } = data;
  void storage_path; void frame_paths; void pet_id;

  return NextResponse.json({
    ...rest,
    canExportPdf,
    imageUrl,
    isVideo,
    frameCount: Array.isArray(data.frame_paths) ? data.frame_paths.length : 1,
    pet,
  });
}

// GET /api/analysis/[id]
// Polled by the /analysis/[id] page while waiting for the worker to finish.
// Returns the analysis row (status + result_json once complete) for the
// requesting user only. RLS enforces the user_id match at the DB layer too.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
        "id, status, result_json, refusal_code, model, prompt_version, duration_ms, created_at, completed_at",
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

  return NextResponse.json({ ...data, canExportPdf });
}

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

  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, status, result_json, refusal_code, model, prompt_version, duration_ms, created_at, completed_at",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("analyses_select_failed", error.message);
    return NextResponse.json({ error: "select_failed" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

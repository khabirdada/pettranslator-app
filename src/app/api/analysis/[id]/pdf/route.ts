// GET /api/analysis/[id]/pdf
//
// Vet-ready PDF export. Gated to active subscribers (Premium + Pro) and
// testers — anyone listed in the Premium/Pro card features as having
// "Vet-ready PDF exports".
//
// Stream-as-attachment so the browser triggers a download rather than
// inline-rendering. Filename includes the pet name (when known) so it
// lands in the user's downloads folder with a meaningful label.

import { type NextRequest } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { AnalysisPdf, type AnalysisOutput, type PetMeta } from "@/lib/pdf/analysis-pdf";

// Node runtime required — @react-pdf uses Buffer/streams that aren't
// available on the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilenameFragment(input: string | null | undefined, fallback: string): string {
  if (!input) return fallback;
  return input
    .trim()
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .toLowerCase() || fallback;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. AuthN — must be signed in
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Fetch the analysis row + the user's tier in parallel.
  //    RLS still enforces user_id at the DB layer; the .eq filter
  //    is belt-and-suspenders.
  const svc = createServiceClient();
  const [{ data: analysis, error: aErr }, { data: profile }] = await Promise.all([
    svc
      .from("analyses")
      .select(
        "id, user_id, pet_id, result_json, status, refusal_code, model, prompt_version, completed_at, created_at",
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    svc
      .from("profiles")
      .select("subscription_status, subscription_tier, is_tester, tester_expires_at")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (aErr || !analysis) {
    return new Response("Not found", { status: 404 });
  }

  // 3. Gate — Premium + Pro + Testers can export. Free cannot.
  //    Testers expire on tester_expires_at; honor that.
  const now = new Date();
  const testerActive =
    !!profile?.is_tester &&
    (!profile?.tester_expires_at || new Date(profile.tester_expires_at) > now);
  const isPaid = profile?.subscription_status === "active";
  if (!isPaid && !testerActive) {
    return new Response("Subscription required", {
      status: 402,
      headers: { "x-upgrade-url": "/pricing" },
    });
  }

  // 4. Only allow PDF for complete analyses
  if (analysis.status !== "complete" || !analysis.result_json) {
    return new Response("Analysis not complete", { status: 409 });
  }

  const output = analysis.result_json as AnalysisOutput;
  if (output.result_type !== "analysis") {
    // refused analyses don't get PDFs — nothing useful to print
    return new Response("Analysis was refused", { status: 422 });
  }

  // 5. Pet metadata (optional — enriches the title block)
  let pet: PetMeta | null = null;
  if (analysis.pet_id) {
    const { data: petRow } = await svc
      .from("pet_profiles")
      .select("name, species, approximate_age, breed")
      .eq("id", analysis.pet_id)
      .maybeSingle();
    if (petRow) pet = petRow;
  }

  // 6. Render — react-pdf returns a Node Readable; convert to a Web
  //    ReadableStream so Next's Response can stream it directly.
  let stream;
  try {
    stream = await renderToStream(
      AnalysisPdf({
        output,
        analysisId: analysis.id,
        model: analysis.model,
        promptVersion: analysis.prompt_version,
        generatedAt: new Date(analysis.completed_at ?? analysis.created_at),
        pet,
      }),
    );
  } catch (error) {
    console.error("PDF render failed", {
      analysisId: analysis.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "PDF generation failed. Please try again." },
      { status: 500 },
    );
  }

  const webStream = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (err: Error) => controller.error(err));
    },
  });

  const petFragment = safeFilenameFragment(pet?.name, output.species);
  const dateFragment = (analysis.completed_at ?? analysis.created_at)
    .slice(0, 10);
  const filename = `pettranslator-${petFragment}-${dateFragment}.pdf`;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

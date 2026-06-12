"use client";

// ANALYSIS RESULT PAGE — editorial two-column layout.
//
// Design intent (overrides the previous single-column flow):
//   - LEFT (640px max): the report itself, in 8 numbered sections.
//     Each section opens with a mono "§ NN · Title" eyebrow so the
//     report reads like a structured document, not a feed.
//   - RIGHT (sticky on desktop): the analyzed photo, the at-a-glance
//     chips, and a small metadata block. Stays in view as the owner
//     scrolls so interpretation never detaches from evidence.
//
// Brand rules enforced here:
//   - Third-person clinical voice in the interpretation (we don't
//     control the prose — that's the prompt's job — but the framing
//     never adds first-person dialogue, emoji, or "Powered by AI" copy).
//   - One confidence score on one primary state. The "confidence-as-
//     instrument" line uses a hairline rule + a dot marker, not a
//     gauge or stacked bars.
//   - Observed markers shown as a numbered ledger BEFORE the
//     interpretation reads as a vibe. The numbers (01, 02, ...) and
//     the "8 observed" badge make this look like a citation list.
//   - "What couldn't be assessed" is deliberately quieter — em-dash
//     bullets, slate text, italic foot.
//
// Loading / refusal / failure / poll-exhausted states are preserved
// from the previous version. Only the COMPLETE-status render is new.

import { useEffect, useState, use, useRef } from "react";
import Link from "next/link";
import { pickRelatedArticles, articleUrl, heroThumbUrl } from "@/lib/related-articles";

type PetMeta = {
  name: string;
  species: string;
  breed: string | null;
  approximate_age: string | null;
};

type AnalysisRecord = {
  id: string;
  status: "pending" | "processing" | "complete" | "failed" | "refused";
  result_json: unknown;
  refusal_code: string | null;
  model: string;
  prompt_version: string;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
  user_context?: string | null;
  /** Set server-side based on subscription_status + is_tester. Drives the
   *  "Download vet-ready PDF" button visibility. The PDF route also
   *  enforces this server-side; this flag is purely UI affordance. */
  canExportPdf?: boolean;
  /** Signed 5-min URL to the analyzed image (first frame for video). */
  imageUrl?: string | null;
  /** True when the analysis came from a multi-frame video upload. */
  isVideo?: boolean;
  /** Frame count (1 for image, 5 for video). */
  frameCount?: number;
  /** Pet metadata if the analysis was tagged to a pet profile. */
  pet?: PetMeta | null;
};

type AnalysisOutput =
  | {
      result_type: "analysis";
      species: "dog" | "cat";
      observed_markers: string[];
      /** v1.1+ — 3-5 scannable plain-English chips. Optional for backward compat. */
      instant_observations?: string[];
      /** v1.1+ — list of things not visible due to framing/lighting. Optional. */
      not_observed?: string[];
      emotional_state: string;
      confidence_score: number;
      confidence_rationale: string;
      /** v1.2+ third-person behavioral interpretation. v1.0/v1.1 was first-person — same field, different voice. */
      translation: string;
      /** v1.2+ — 2-4 imperative Do items. Older analyses won't have this. */
      action_plan_do?: string[];
      /** v1.2+ — 1-3 imperative Avoid items. Older analyses won't have this. */
      action_plan_avoid?: string[];
      owner_action_plan: string;
      refer_to_professional: boolean;
      notes?: string | null;
    }
  | {
      result_type: "refusal";
      refusal_code: string;
      user_message: string;
      recommended_next_step: string;
    };

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 80; // ~2 minutes

/**
 * Map 40-95 numeric confidence into a perceptually accurate tier.
 * The redesign also uses these tiers to drive the bottom tier-map
 * highlight in the rationale accordion.
 */
function confidenceLabel(score: number): { tier: string; tone: "terra" | "slate" } {
  if (score >= 90) return { tier: "Very High", tone: "terra" };
  if (score >= 75) return { tier: "High", tone: "terra" };
  if (score >= 60) return { tier: "Moderate", tone: "slate" };
  return { tier: "Lower", tone: "slate" };
}

function refusalReasonChip(code: string): string {
  switch (code) {
    case "no_subject_detected": return "Not clearly a dog or cat";
    case "insufficient_signal": return "Face or body not visible enough";
    case "unsupported_species": return "Species not yet supported";
    case "out_of_scope": return "Outside scope (wild or farm animal)";
    case "policy_violation": return "Image flagged by safety policy";
    case "veterinary_referral_required": return "Possible medical signs visible";
    default: return code.replace(/_/g, " ");
  }
}

/**
 * "Mild anxiety" → ["Signals consistent with ", "mild anxiety", ""].
 * The middle slice is wrapped in <em class="text-terra"> for the masthead
 * headline. We deliberately preface the model's terse phrase ("appears
 * anxious") with "Signals consistent with" so the headline reads like a
 * clinical observation, not a verdict.
 */
function headlineSplit(emotionalState: string): { lead: string; emphasis: string } {
  const trimmed = (emotionalState || "").trim();
  // If the model already returned a clinical-style phrase, don't re-prefix
  if (/^signals|^consistent with|^appears/i.test(trimmed)) {
    return { lead: "", emphasis: trimmed };
  }
  return { lead: "Signals consistent with", emphasis: trimmed };
}

/**
 * Format the report's date+time line in the masthead.
 * e.g., "June 12, 2026 · 4:18 PM"
 */
function formatReportDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    + " · "
    + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

/** Generate a short, stable-looking report ID from the UUID. */
function shortReportId(uuid: string): string {
  const cleaned = uuid.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `BR-${cleaned.slice(0, 4)}`;
}

export default function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const [showAllMarkers, setShowAllMarkers] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const rationaleRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    let n = 0;

    async function tick() {
      try {
        const res = await fetch(`/api/analysis/${id}`);
        if (!active) return;
        if (!res.ok) {
          if (res.status === 404) setError("not_found");
          else setError(`http_${res.status}`);
          return;
        }
        const json = (await res.json()) as AnalysisRecord;
        setData(json);
        n += 1;
        setPolls(n);
        const isTerminal =
          json.status === "complete" ||
          json.status === "failed" ||
          json.status === "refused";
        if (!isTerminal && n < MAX_POLLS) {
          setTimeout(tick, POLL_INTERVAL_MS);
        } else if (!isTerminal) {
          setError("poll_exhausted");
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "fetch_failed");
      }
    }

    tick();
    return () => {
      active = false;
    };
  }, [id]);

  // -------- ERROR STATE (preserved verbatim from previous version) --------
  if (error) {
    const friendly: Record<string, { title: string; body: string }> = {
      not_found: {
        title: "Analysis not found",
        body: "We couldn't find this analysis. It may have been deleted, or the link might be wrong. Your other analyses are still in your dashboard.",
      },
      poll_exhausted: {
        title: "Still processing",
        body: "This analysis is taking longer than two minutes — that's well outside our usual range. Your image is saved; refresh in a minute or check your dashboard. If it keeps showing up as processing, email hello@pettranslator.ai and we'll look at it personally.",
      },
      fetch_failed: {
        title: "Connection problem",
        body: "We lost the connection while checking the status. Reload the page — your analysis is safe on our side.",
      },
    };
    const f = friendly[error] ?? {
      title: "Something broke",
      body: `Code: ${error}. Refresh the page or come back in a minute — your image is safe.`,
    };
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <p className="label mb-4">§ {error === "poll_exhausted" ? "Status update" : "Issue"}</p>
        <h1 className="mb-6">{f.title}</h1>
        <p className="text-slate max-w-prose leading-relaxed mb-8">{f.body}</p>
        <div className="flex flex-col sm:flex-row gap-3">
          {error === "poll_exhausted" && (
            <button
              onClick={() => window.location.reload()}
              className="btn w-full sm:w-auto justify-center"
            >
              Refresh now →
            </button>
          )}
          <Link href="/dashboard" className="btn btn-light w-full sm:w-auto justify-center">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  // -------- LOADING STATE (preserved) --------
  if (!data || data.status === "pending" || data.status === "processing") {
    const elapsedSec = data?.created_at
      ? Math.floor((Date.now() - new Date(data.created_at).getTime()) / 1000)
      : Math.floor((polls * POLL_INTERVAL_MS) / 1000);
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <p className="label mb-4">§ Live analysis</p>
        <h1 className="mb-6">
          Reading the <em className="text-terra">signals</em>…
        </h1>
        <p className="text-slate mb-6 max-w-prose leading-relaxed">
          {data?.status === "processing"
            ? "Analyzing posture, gaze, jaw tension, ear angle, weight distribution. The same markers a board-certified behaviorist would check — in about ten seconds."
            : "Beginning behavioral analysis. The AI starts examining markers in under ten seconds."}
        </p>
        <div className="flex items-center gap-3 mb-4 text-sm text-slate-soft font-mono">
          <span className="inline-block size-2 rounded-full bg-terra animate-pulse" />
          <span>{(data?.status ?? "pending").toUpperCase()} · {elapsedSec}s elapsed</span>
        </div>
        {elapsedSec >= 15 && elapsedSec < 45 && (
          <p className="text-sm text-slate leading-relaxed max-w-prose">
            Taking a little longer than usual — typical analyses finish in 6–15s.
            We&rsquo;re still working on it.
          </p>
        )}
        {elapsedSec >= 45 && (
          <p className="text-sm text-slate leading-relaxed max-w-prose">
            Almost there. If we don&rsquo;t finish by 2 minutes, this page will
            offer a refresh — your upload is safe either way.
          </p>
        )}
      </main>
    );
  }

  // -------- FAILED STATE (preserved) --------
  if (data.status === "failed") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <p className="label mb-4">§ Couldn&apos;t finish</p>
        <h1 className="mb-6">We couldn&apos;t finish that one.</h1>
        <p className="text-slate max-w-prose leading-relaxed">
          The analysis hit an unrecoverable error after multiple retries. This
          doesn&apos;t count against your free analyses — try a different image
          or the same image again in a few minutes.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 pt-8">
          <Link href="/analyze" className="btn w-full sm:w-auto justify-center">
            Try another image →
          </Link>
          <Link href="/dashboard" className="btn btn-light w-full sm:w-auto justify-center">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const output = data.result_json as AnalysisOutput;

  // -------- REFUSAL STATE (preserved) --------
  if (data.status === "refused" || output?.result_type === "refusal") {
    const refusal = output as Extract<AnalysisOutput, { result_type: "refusal" }>;
    const isVet = refusal.refusal_code === "veterinary_referral_required";
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <p className="label mb-4">§ {isVet ? "Veterinary referral" : "Input quality"}</p>
        <h1 className="mb-6">
          {isVet ? (
            <>Please see your <em className="text-terra">vet</em>.</>
          ) : (
            <>We couldn&apos;t <em className="text-terra">confidently assess</em> this photo.</>
          )}
        </h1>
        {!isVet && (
          <div className="inline-flex items-center gap-2 border border-rule rounded-full px-3.5 py-1.5 text-sm bg-paper-light mb-6">
            <span className="text-terra font-mono text-xs">·</span>
            <span className="text-ink">{refusalReasonChip(refusal.refusal_code)}</span>
          </div>
        )}
        <p className="text-slate text-lg leading-relaxed mb-6 max-w-prose">
          {refusal.user_message}
        </p>
        <p className="label mb-2">What to try next</p>
        <p className="text-slate mb-8 max-w-prose">{refusal.recommended_next_step}</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/analyze" className="btn w-full sm:w-auto justify-center">
            Try another image →
          </Link>
          <Link href="/dashboard" className="btn btn-light w-full sm:w-auto justify-center">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  // ===== COMPLETE STATE — the new editorial design =====
  const r = output as Extract<AnalysisOutput, { result_type: "analysis" }>;
  const conf = confidenceLabel(r.confidence_score);
  const { lead, emphasis } = headlineSplit(r.emotional_state);

  const VISIBLE_MARKER_CAP = 5;
  const markersToShow = showAllMarkers
    ? r.observed_markers
    : r.observed_markers.slice(0, VISIBLE_MARKER_CAP);
  const hiddenMarkerCount = r.observed_markers.length - VISIBLE_MARKER_CAP;

  const hasStructuredActions =
    (r.action_plan_do && r.action_plan_do.length > 0) ||
    (r.action_plan_avoid && r.action_plan_avoid.length > 0);

  const speciesLabel = r.species === "dog" ? "Dog" : "Cat";
  const breedLine = data.pet?.breed
    ? `${speciesLabel} · ${data.pet.breed}`
    : speciesLabel;
  const subjectName = data.pet?.name ?? speciesLabel;
  const reportId = shortReportId(data.id);
  const reportDate = formatReportDate(data.completed_at ?? data.created_at);
  const durationS = data.duration_ms ? (data.duration_ms / 1000).toFixed(1) : null;

  // Width as a percentage of the 40–95 scale used by confidenceLabel.
  // Clamped so 40 → ~0% and 95 → 100%.
  const confidencePct = Math.max(0, Math.min(100, ((r.confidence_score - 40) / 55) * 100));

  // Smooth scroll to rationale when the "How this was scored" link is clicked
  const scrollToRationale = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowRationale(true);
    rationaleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="bg-paper text-ink min-h-screen">
      {/* ===== ① MASTHEAD — full-width headline + confidence-as-instrument ===== */}
      <header className="mx-auto max-w-[1120px] px-6 sm:px-10 pt-12 sm:pt-14 pb-10 sm:pb-11 border-b border-rule">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-slate-soft mb-5">
          <span className="text-terra">§ 01</span> · Behavioral analysis · Report {reportId}
        </p>
        <div className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-slate-soft mb-5 flex flex-wrap items-center">
          {[subjectName, breedLine, reportDate].filter(Boolean).map((piece, i, arr) => (
            <span key={i} className="flex items-center">
              <span>{piece}</span>
              {i < arr.length - 1 && (
                <span className="mx-2.5 text-rule" aria-hidden>·</span>
              )}
            </span>
          ))}
        </div>
        <h1 className="font-serif font-medium text-[2.4rem] sm:text-[3rem] md:text-[3.6rem] leading-[1.12] tracking-[-0.01em] max-w-[820px]">
          {lead && <span>{lead} </span>}
          <em className="text-terra not-italic font-medium italic">{emphasis}</em>
        </h1>

        {/* Confidence line — hairline rule, terra fill, dot marker.
            Read as a single instrument, not a gauge. Scale labels below
            anchor the tier boundaries (40/60/75/90/95). */}
        <div className="mt-8 max-w-[560px]">
          <div className="flex items-baseline justify-between mb-2.5">
            <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink">
              {conf.tier} confidence ·{" "}
              <strong className={`font-medium ${conf.tone === "terra" ? "text-terra" : "text-slate"}`}>
                {r.confidence_score}%
              </strong>
            </span>
            <a
              href="#rationale"
              onClick={scrollToRationale}
              className="text-[13px] font-medium text-terra hover:underline underline-offset-2"
            >
              How this was scored ↓
            </a>
          </div>
          <div
            className="relative h-px bg-rule"
            role="img"
            aria-label={`Confidence score: ${r.confidence_score} out of 100, ${conf.tier} tier`}
          >
            <div
              className="absolute left-0 top-0 h-px bg-terra"
              style={{ width: `${confidencePct}%` }}
            />
            <div
              className="absolute top-1/2 size-[9px] rounded-full bg-terra"
              style={{
                left: `${confidencePct}%`,
                transform: "translate(-50%, -50%)",
                boxShadow: "0 0 0 4px var(--paper)",
              }}
            />
          </div>
          <div className="flex justify-between mt-2 font-mono text-[10px] tracking-[0.08em] text-slate-soft">
            <span>40</span><span>60</span><span>75</span><span>90</span><span>95</span>
          </div>
        </div>
      </header>

      {/* ===== TWO-COLUMN BODY ===== */}
      <div className="mx-auto max-w-[1120px] px-6 sm:px-10 pb-24 grid lg:grid-cols-[minmax(0,640px)_minmax(280px,1fr)] gap-x-16 items-start">

        {/* ----- LEFT COLUMN: the report ----- */}
        <main className="pt-12 sm:pt-14 min-w-0 order-2 lg:order-1">

          {/* ② INTERPRETATION — serif prose with a drop cap.
              Reads like a behaviorist's case-note paragraph. */}
          <section className="pb-12">
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-slate-soft mb-3.5">
              <span className="text-terra">§ 02</span> · Interpretation
            </p>
            <div className="font-serif text-[19px] sm:text-[20px] leading-[1.7] text-ink">
              <p className="[&::first-letter]:font-serif [&::first-letter]:font-medium [&::first-letter]:text-[64px] [&::first-letter]:leading-[0.82] [&::first-letter]:float-left [&::first-letter]:pr-3 [&::first-letter]:pt-1.5 [&::first-letter]:text-terra">
                {r.translation}
              </p>
            </div>

            {/* Action plan — Do / Avoid side-by-side, hairline border, no rounded corners */}
            {hasStructuredActions && (
              <div className="mt-9 grid sm:grid-cols-2 border border-rule">
                {r.action_plan_do && r.action_plan_do.length > 0 && (
                  <div className="p-6 sm:p-7">
                    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-terra mb-4">
                      Do today
                    </p>
                    <ul className="space-y-3 text-[14.5px] leading-[1.55] text-slate">
                      {r.action_plan_do.map((item, i) => (
                        <li key={i} className="pl-5 relative font-medium">
                          <span className="absolute left-0 text-terra font-normal">→</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {r.action_plan_avoid && r.action_plan_avoid.length > 0 && (
                  <div className="p-6 sm:p-7 border-t sm:border-t-0 sm:border-l border-rule">
                    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-slate-soft mb-4">
                      Avoid
                    </p>
                    <ul className="space-y-3 text-[14.5px] leading-[1.55] text-slate">
                      {r.action_plan_avoid.map((item, i) => (
                        <li key={i} className="pl-5 relative font-medium">
                          <span className="absolute left-0 text-slate-soft font-normal">×</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Legacy v1.0/v1.1 fallback — flat prose action plan */}
            {!hasStructuredActions && (
              <div className="mt-7 pl-5 border-l-2 border-terra">
                <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-slate-soft mb-2">
                  Action plan
                </p>
                <p className="text-ink text-[15px] leading-relaxed max-w-prose">
                  {r.owner_action_plan}
                </p>
              </div>
            )}
          </section>

          {/* ③ VET-READY PDF — quiet utility row. Hairline border + paper-light bg. */}
          {data.canExportPdf && (
            <section className="pt-11 pb-11 border-t border-rule">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 bg-paper-light border border-rule px-6 sm:px-7 py-6">
                <div className="min-w-0">
                  <p className="font-serif text-[17px] sm:text-[18px] font-semibold text-ink mb-1">
                    Vet-ready report
                  </p>
                  <p className="text-[13px] text-slate-soft leading-snug max-w-md">
                    A printable version of this analysis, formatted for a
                    veterinary or behaviorist consult.
                  </p>
                </div>
                <a
                  href={`/api/analysis/${id}/pdf`}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-terra text-paper-light text-[14px] font-semibold px-6 py-3 whitespace-nowrap hover:bg-[#A04E35] transition-colors"
                  data-analytics="pdf-export"
                >
                  Download PDF
                </a>
              </div>
            </section>
          )}

          {/* ④ BEHAVIORIST REFERRAL — the one allowed moment of color-block emphasis */}
          {r.refer_to_professional && (
            <section className="pt-11 pb-11 border-t border-rule">
              <div
                className="px-7 sm:px-8 py-7 border-l-2 border-terra"
                style={{ background: "var(--terra-cream)" }}
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-terra mb-2.5">
                  Professional referral suggested
                </p>
                <h2 className="font-serif font-medium text-[22px] sm:text-[24px] leading-[1.3] text-ink mb-2.5">
                  A pattern worth a behaviorist&apos;s eyes
                </h2>
                <p className="text-[14.5px] sm:text-[15px] text-slate max-w-[52ch] leading-relaxed">
                  If these signals recur across multiple contexts — not just
                  this one moment — a certified behavior consultant can assess
                  what a single image cannot. Look for CBCC-KA, CSAT, CDBC, or
                  Fear-Free credentials. This is a recommendation, not an alarm.
                </p>
              </div>
            </section>
          )}

          {/* ⑤ OBSERVED CUES — the evidence ledger */}
          <section className="pt-11 pb-11 border-t border-rule">
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-slate-soft mb-3.5">
              <span className="text-terra">§ 05</span> · Evidence
            </p>
            <div className="flex items-baseline justify-between gap-4 mb-2.5">
              <h2 className="font-serif font-medium text-[24px] sm:text-[26px] tracking-[-0.005em] text-ink">
                Observed body-language markers
              </h2>
              <span className="text-[13px] text-slate-soft font-mono whitespace-nowrap">
                {r.observed_markers.length} observed
              </span>
            </div>
            <ol className="mt-3.5 list-none">
              {markersToShow.map((m, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[44px_1fr] gap-[18px] py-4 border-b border-rule last:border-b-0"
                >
                  <span className="font-mono text-[12px] text-terra pt-[3px]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[14.5px] text-slate leading-[1.55]">{m}</span>
                </li>
              ))}
            </ol>
            {hiddenMarkerCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllMarkers((v) => !v)}
                aria-expanded={showAllMarkers}
                className="w-full mt-1 border-t border-rule pt-4 font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] text-terra cursor-pointer flex items-center gap-2.5 text-left hover:underline"
              >
                <span
                  className="inline-block transition-transform duration-200"
                  style={{ transform: showAllMarkers ? "rotate(90deg)" : "rotate(0deg)" }}
                >
                  →
                </span>
                <span>
                  {showAllMarkers ? "Show fewer observations" : `Show ${hiddenMarkerCount} more observations`}
                </span>
              </button>
            )}
          </section>

          {/* ⑥ WHAT WASN'T VISIBLE — deliberately quieter */}
          {r.not_observed && r.not_observed.length > 0 && (
            <section className="pt-11 pb-11 border-t border-rule">
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-slate-soft mb-3.5">
                <span className="text-terra">§ 06</span> · Limits of this image
              </p>
              <h2 className="font-serif font-medium text-[24px] sm:text-[26px] tracking-[-0.005em] text-slate">
                What couldn&apos;t be assessed
              </h2>
              <ul className="mt-4 space-y-3">
                {r.not_observed.map((item, i) => (
                  <li
                    key={i}
                    className="text-[14.5px] text-slate-soft pl-5 relative leading-[1.55]"
                  >
                    <span className="absolute left-0 text-rule">—</span>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-5 pt-3.5 border-t border-dashed border-rule font-serif italic text-[13px] text-slate-soft">
                A report that claims to see everything should not be trusted.
                These gaps are part of the read.
              </p>
            </section>
          )}

          {/* ⑦ CONFIDENCE RATIONALE — collapsed accordion. Scroll target from masthead. */}
          <section
            ref={rationaleRef}
            id="rationale"
            className="pt-11 pb-11 border-t border-rule scroll-mt-8"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-slate-soft mb-3.5">
              <span className="text-terra">§ 07</span> · Methodology
            </p>
            <button
              type="button"
              onClick={() => setShowRationale((v) => !v)}
              aria-expanded={showRationale}
              aria-controls="rationale-panel"
              className="w-full text-left flex items-baseline justify-between gap-5 cursor-pointer group"
            >
              <h2 className="font-serif font-medium text-[24px] sm:text-[26px] tracking-[-0.005em] text-ink group-hover:text-terra transition-colors">
                Why {r.confidence_score}%, not higher
              </h2>
              <span
                className="text-terra inline-block transition-transform duration-200"
                style={{ transform: showRationale ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                →
              </span>
            </button>
            {showRationale && (
              <div id="rationale-panel" className="pt-5 text-[15px] text-slate leading-relaxed max-w-[58ch]">
                <p>{r.confidence_rationale}</p>
                {/* Tier map — visualizes where THIS score sits on the 4-tier scale */}
                <div
                  className="mt-5 flex border border-rule font-mono text-[10.5px] tracking-[0.06em] uppercase text-slate-soft"
                  role="img"
                  aria-label={`Confidence tiers. This report: ${conf.tier}.`}
                >
                  {[
                    { label: "Lower", range: "< 60", active: r.confidence_score < 60 },
                    { label: "Moderate", range: "60–74", active: r.confidence_score >= 60 && r.confidence_score < 75 },
                    { label: "High", range: "75–89", active: r.confidence_score >= 75 && r.confidence_score < 90 },
                    { label: "Very high", range: "≥ 90", active: r.confidence_score >= 90 },
                  ].map((t, i) => (
                    <div
                      key={t.label}
                      className={`flex-1 px-3 py-2.5 ${i > 0 ? "border-l border-rule" : ""} ${t.active ? "bg-paper-light text-terra" : ""}`}
                    >
                      <b className={`block text-[11px] mb-0.5 font-medium ${t.active ? "text-terra" : "text-slate-soft"}`}>
                        {t.label}
                      </b>
                      {t.range}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ⑧ RELATED READING — deterministic match against the blog */}
          {(() => {
            const related = pickRelatedArticles({
              species: r.species,
              emotionalState: r.emotional_state,
              markers: r.observed_markers,
              referToProfessional: r.refer_to_professional,
            }, 3);
            if (!related.length) return null;
            return (
              <section className="pt-11 pb-11 border-t border-rule">
                <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-slate-soft mb-3.5">
                  <span className="text-terra">§ 08</span> · From the journal
                </p>
                <h2 className="font-serif font-medium text-[24px] sm:text-[26px] tracking-[-0.005em] text-ink">
                  Related reading
                </h2>
                <p className="mt-3 text-[14px] text-slate-soft leading-relaxed max-w-prose">
                  The single analysis above is one moment in time. These guides
                  put it in context.
                </p>
                <ul className="mt-6 grid sm:grid-cols-3 gap-5 items-stretch">
                  {related.map((a) => (
                    <li key={a.slug} className="h-full">
                      <a
                        href={articleUrl(a.slug)}
                        target="_blank"
                        rel="noopener"
                        className="group flex flex-col h-full border border-rule bg-paper hover:border-terra transition-colors overflow-hidden"
                      >
                        <div className="aspect-[16/10] overflow-hidden bg-paper-deep">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={heroThumbUrl(a.slug)}
                            alt=""
                            width={600}
                            height={375}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                          />
                        </div>
                        <div className="p-5 flex-1 flex flex-col gap-2.5">
                          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-soft">
                            {a.category.replace(/-/g, " ")}
                          </p>
                          <h3 className="font-serif font-medium text-[17px] sm:text-[18px] leading-[1.35] text-ink group-hover:text-terra transition-colors">
                            {a.title}
                          </h3>
                          <p className="text-[12px] text-slate-soft mt-auto pt-1">
                            {a.readingTime}
                          </p>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })()}

          {/* Disclaimer */}
          <p className="border-t border-rule pt-6 text-[12.5px] text-slate-soft max-w-[60ch] leading-relaxed">
            PetTranslator.ai produces behavioral interpretations from visual
            evidence. It is not a veterinary diagnosis and not a substitute
            for veterinary care. If your pet shows sudden behavioral change,
            see a veterinarian first to rule out pain or illness.
          </p>

          {/* Footer CTAs */}
          <div className="mt-10 pt-6 border-t border-rule flex flex-col sm:flex-row gap-3">
            <Link href="/analyze" className="btn w-full sm:w-auto justify-center">
              Analyze another →
            </Link>
            <Link href="/dashboard" className="btn btn-light w-full sm:w-auto justify-center">
              Back to dashboard
            </Link>
          </div>

          <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.06em] text-slate-soft">
            Model · {data.model} · prompt v{data.prompt_version}
            {durationS && <> · {durationS}s</>}
          </p>
        </main>

        {/* ----- RIGHT COLUMN: sticky evidence rail ----- */}
        <aside
          aria-label="Source evidence"
          className="pt-12 sm:pt-14 lg:sticky lg:top-10 order-1 lg:order-2"
        >
          {/* Photo frame — hairline border + paper-light mat, 4:5 portrait
              crop fits both square uploads and landscape clips. */}
          {data.imageUrl ? (
            <figure className="border border-rule bg-paper-light p-2.5">
              <div className="aspect-[4/5] overflow-hidden bg-paper-deep">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data.imageUrl}
                  alt={data.pet?.name ? `Uploaded photo of ${data.pet.name}` : "Uploaded photo of pet"}
                  className="w-full h-full object-cover"
                />
              </div>
              <figcaption className="flex justify-between font-mono text-[10.5px] uppercase tracking-[0.1em] text-slate-soft pt-2.5 px-0.5">
                <span>
                  Source · {data.isVideo
                    ? `${data.frameCount ?? 5} frames`
                    : "1 photo"}
                </span>
                {durationS && <span>Analyzed in {durationS}s</span>}
              </figcaption>
            </figure>
          ) : (
            // Placeholder when the signed URL couldn't be minted
            <div className="border border-rule bg-paper-light p-2.5">
              <div
                className="aspect-[4/5] flex items-center justify-center text-slate-soft text-[12px] font-mono"
                style={{ background: "var(--paper-deep)" }}
              >
                Photo unavailable
              </div>
            </div>
          )}

          {/* At-a-glance chips — the 3–5 scannable observations.
              First reaction the owner sees before reading the prose. */}
          {r.instant_observations && r.instant_observations.length > 0 && (
            <div className="mt-7">
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.15em] text-slate-soft mb-3">
                At a glance
              </p>
              <ul className="flex flex-wrap gap-2">
                {r.instant_observations.map((obs, i) => (
                  <li
                    key={i}
                    className="text-[12.5px] font-medium text-slate border border-rule bg-paper-light rounded-full px-3.5 py-1.5"
                  >
                    {obs}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Rail metadata — pet profile + owner context + report ID */}
          <dl className="mt-7 pt-4 border-t border-rule text-[12.5px] text-slate-soft grid gap-2">
            {data.pet && (
              <div className="flex justify-between gap-4">
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em]">
                  Pet profile
                </dt>
                <dd className="text-slate font-medium text-right">
                  {data.pet.name}
                  {data.pet.approximate_age && ` · ${data.pet.approximate_age}`}
                </dd>
              </div>
            )}
            {data.user_context && (
              <div className="flex justify-between gap-4">
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em]">
                  Owner context
                </dt>
                <dd className="text-slate font-medium text-right max-w-[60%] truncate">
                  &ldquo;{data.user_context}&rdquo;
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em]">
                Report ID
              </dt>
              <dd className="text-slate font-medium">{reportId}</dd>
            </div>
          </dl>
        </aside>

      </div>
    </div>
  );
}

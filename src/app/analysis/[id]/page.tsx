"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { pickRelatedArticles, articleUrl, heroThumbUrl } from "@/lib/related-articles";

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
  /** Set server-side based on subscription_status + is_tester. Drives the
   *  "Download vet-ready PDF" button visibility. The PDF route also
   *  enforces this server-side; this flag is purely UI affordance. */
  canExportPdf?: boolean;
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
 * Map 40-95 numeric confidence into a perceptually accurate label.
 * v1.2: rendered VERTICALLY-STACKED (tier on its own line, percent below as
 * subtext) so humans anchor to the qualitative tier first rather than the
 * number. Per round-2 critique.
 */
function confidenceLabel(score: number): { tier: string; tone: "terra" | "slate" } {
  if (score >= 90) return { tier: "Very High", tone: "terra" };
  if (score >= 75) return { tier: "High", tone: "terra" };
  if (score >= 60) return { tier: "Moderate", tone: "slate" };
  return { tier: "Lower", tone: "slate" };
}

/**
 * Human-readable reason for a refusal code. Shown as a chip beneath the
 * refusal headline so the user understands why instead of feeling like
 * the app errored.
 */
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
  const [showWhy, setShowWhy] = useState(false);

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
          // Polling exhausted — previous version silently stopped, leaving the
          // user staring at a spinner forever. Surface a recoverable error
          // so they can navigate away or retry.
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

  if (error) {
    // Friendly messages for the codes we expect to see. Anything else
    // shows the raw code so we can debug from support tickets.
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

  if (!data || data.status === "pending" || data.status === "processing") {
    // Each poll is ~POLL_INTERVAL_MS apart so we can derive elapsed
    // seconds from the poll count. Don't recompute on render — anchor
    // to data.created_at when we have it for accuracy.
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

        {/* Live pulse + elapsed-time chip so the user can see the
            page is working, not frozen. Progressive copy at 15s/45s
            sets a realistic expectation before the hard timeout at
            ~2 min hits poll_exhausted. */}
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

  // Complete + analysis result
  const r = output as Extract<AnalysisOutput, { result_type: "analysis" }>;
  const conf = confidenceLabel(r.confidence_score);

  const VISIBLE_MARKER_CAP = 5;
  const markersToShow = showAllMarkers
    ? r.observed_markers
    : r.observed_markers.slice(0, VISIBLE_MARKER_CAP);
  const hiddenMarkerCount = r.observed_markers.length - VISIBLE_MARKER_CAP;

  // v1.2+: structured Do/Avoid lists. Older analyses fall back to flat prose.
  const hasStructuredActions =
    (r.action_plan_do && r.action_plan_do.length > 0) ||
    (r.action_plan_avoid && r.action_plan_avoid.length > 0);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 sm:py-20">
      {/* HEADER */}
      <p className="label mb-3">§ Report · {r.species}</p>
      <h1 className="mb-6 text-2xl sm:text-3xl">
        {r.emotional_state.split(" ").slice(0, -1).join(" ")}{" "}
        <em className="text-terra">
          {r.emotional_state.split(" ").slice(-1)[0]}.
        </em>
      </h1>

      {/* CONFIDENCE — stacked vertically. Tier first, percent as subtext. */}
      <div className="mb-10">
        <p className="label mb-1">Confidence</p>
        <p className={`font-serif text-2xl mb-0.5 ${conf.tone === "terra" ? "text-terra" : "text-slate"}`}>
          {conf.tier}
        </p>
        <p className="text-xs text-slate-soft font-mono">
          {r.confidence_score}% signal agreement
        </p>
      </div>

      {/* INSTANT OBSERVATIONS — 2-second scannable chips (v1.1+) */}
      {r.instant_observations && r.instant_observations.length > 0 && (
        <section className="mb-10">
          <p className="label mb-3">What we noticed first</p>
          <ul className="flex flex-wrap gap-2">
            {r.instant_observations.map((obs, i) => (
              <li
                key={i}
                className="inline-flex items-center gap-2 border border-rule rounded-full px-3.5 py-1.5 text-sm bg-paper-light"
              >
                <span className="text-terra font-mono text-xs">✓</span>
                <span className="text-ink">{obs}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* BEHAVIORAL INTERPRETATION — third-person clinical voice in v1.2+ */}
      <section className="mb-10">
        <p className="label mb-2">Behavioral interpretation</p>
        <blockquote className="font-serif italic text-xl leading-relaxed border-l-2 border-terra pl-5 max-w-xl">
          {r.translation}
        </blockquote>
      </section>

      {/* ACTION PLAN — v1.2+: Do/Avoid checklist with "Why this helps" accordion */}
      <section className="mb-10">
        <p className="label mb-3">What to do</p>

        {hasStructuredActions ? (
          <>
            <div className="grid sm:grid-cols-2 gap-6 mb-6">
              {/* DO column */}
              {r.action_plan_do && r.action_plan_do.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-terra mb-2.5 font-mono uppercase tracking-wider">
                    Do
                  </p>
                  <ul className="space-y-2 text-sm">
                    {r.action_plan_do.map((item, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="text-terra font-mono mt-0.5">✓</span>
                        <span className="text-ink">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* AVOID column */}
              {r.action_plan_avoid && r.action_plan_avoid.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-slate mb-2.5 font-mono uppercase tracking-wider">
                    Avoid
                  </p>
                  <ul className="space-y-2 text-sm">
                    {r.action_plan_avoid.map((item, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="text-slate font-mono mt-0.5">×</span>
                        <span className="text-ink">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* WHY THIS HELPS — collapsed accordion */}
            <button
              type="button"
              onClick={() => setShowWhy((v) => !v)}
              className="label text-ink hover:text-terra cursor-pointer flex items-center gap-2"
              aria-expanded={showWhy}
            >
              <span>{showWhy ? "▴" : "▾"}</span>
              <span>Why this helps</span>
            </button>
            {showWhy && (
              <p className="text-slate text-sm mt-3 max-w-prose leading-relaxed">
                {r.owner_action_plan}
              </p>
            )}
          </>
        ) : (
          // v1.0 / v1.1 fallback — flat prose
          <p className="text-ink text-base leading-relaxed max-w-prose">
            {r.owner_action_plan}
          </p>
        )}
      </section>

      {/* VET-READY PDF EXPORT — Pro/Premium/Tester only.
          Subtle pill button under the action plan. The button is a real
          anchor so the browser handles Content-Disposition: attachment
          natively (no fetch dance, no blob URL leak). data-plausible
          tracks downloads to measure how many users actually print/share
          their reports — strong proxy for value. */}
      {data?.canExportPdf && (
        <div className="mb-10 -mt-2">
          <a
            href={`/api/analysis/${id}/pdf`}
            className="inline-flex items-center gap-2 rounded-full border border-terra/40 hover:border-terra hover:bg-terra hover:text-paper-light text-terra text-sm font-medium px-5 py-2.5 transition"
            data-analytics="pdf-export"
          >
            <span aria-hidden>↓</span>
            <span>Download vet-ready PDF</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] opacity-70">
              · 1 page · A4
            </span>
          </a>
          <p className="text-slate-soft text-xs mt-2 max-w-prose">
            Print-friendly clinical summary — observed markers, interpretation,
            confidence rationale, and the Do/Avoid plan. Bring it to your vet
            or behaviorist.
          </p>
        </div>
      )}

      {/* PROFESSIONAL REFERRAL — high-visibility callout */}
      {r.refer_to_professional && (
        <div className="border border-terra rounded-2xl p-6 mb-10 bg-paper-light">
          <p className="label mb-2" style={{ color: "var(--terra)" }}>
            Behaviorist referral
          </p>
          <p className="text-sm text-ink leading-relaxed">
            This analysis involves behaviors that benefit from a
            positive-reinforcement professional (look for CSAT, CDBC, or Fear
            Free credentials). Don&apos;t attempt self-help protocols for
            aggression, severe separation distress, or stereotypic behavior.
          </p>
        </div>
      )}

      {/* OBSERVED MARKERS — cap to 5 visible, accordion for the rest */}
      <section className="mb-10">
        <p className="label mb-2">Observed biometric cues</p>
        <ol className="space-y-2 text-sm">
          {markersToShow.map((m, i) => (
            <li key={i} className="font-mono flex gap-3">
              <span className="text-terra">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-ink">{m}</span>
            </li>
          ))}
        </ol>
        {hiddenMarkerCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAllMarkers((v) => !v)}
            className="mt-3 label text-terra hover:underline cursor-pointer"
          >
            {showAllMarkers
              ? "▴ Show fewer"
              : `▾ Show ${hiddenMarkerCount} more`}
          </button>
        )}
      </section>

      {/* WHAT WASN'T VISIBLE — occlusion awareness, builds trust (v1.1+) */}
      {r.not_observed && r.not_observed.length > 0 && (
        <section className="mb-10">
          <p className="label mb-2">What wasn&apos;t visible enough to assess</p>
          <ul className="space-y-1.5 text-sm text-slate font-mono">
            {r.not_observed.map((item, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-slate-soft">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* CONFIDENCE RATIONALE — collapsed accordion */}
      <section className="mb-10 border-t border-rule pt-6">
        <button
          type="button"
          onClick={() => setShowRationale((v) => !v)}
          className="label text-ink hover:text-terra cursor-pointer flex items-center gap-2"
          aria-expanded={showRationale}
        >
          <span>{showRationale ? "▴" : "▾"}</span>
          <span>Confidence rationale</span>
        </button>
        {showRationale && (
          <p className="text-slate text-sm mt-3 max-w-prose leading-relaxed">
            {r.confidence_rationale}
          </p>
        )}
      </section>

      {/* RELATED READING — deterministic per-species + behavior-signal
          matching. Drives blog traffic from the most-engaged moment
          (post-analysis), which lifts time-on-site, return visits, and
          AI-search citation indirectly via blog dwell signals. */}
      {(() => {
        const related = pickRelatedArticles({
          species: r.species,
          emotionalState: r.emotional_state,
          markers: r.observed_markers,
          referToProfessional: r.refer_to_professional,
        }, 3);
        if (!related.length) return null;
        return (
          <section className="mb-10 border-t border-rule pt-8">
            {/* Eyebrow + serif headline — matches the rest of the page's
                editorial register so this doesn't read as an ad strip. */}
            <p className="label mb-2 text-slate-soft">§ Go deeper</p>
            <h2 className="font-serif text-xl mb-2">
              Understand <em className="text-terra">your pet</em> better.
            </h2>
            {/* One-line lede explains WHY this row exists — these are the
                pieces that deepen the single-snapshot analysis above into
                a real working understanding of the pet's behavioral patterns. */}
            <p className="text-slate text-sm leading-relaxed mb-10 max-w-prose">
              The single analysis above is one moment in time. These guides
              put it in context — what the signals usually mean, how they
              change with arousal, and what to watch for next.
            </p>
            {/* Stacks vertically on mobile (sm-) for full-width readable
                cards; 3-column grid on sm+. items-stretch + the inner
                <a class="h-full flex flex-col"> ensures all three cards
                are the same height regardless of title length. */}
            <ul className="grid sm:grid-cols-3 gap-5 items-stretch">
              {related.map((a) => (
                <li key={a.slug} className="h-full">
                  <a
                    href={articleUrl(a.slug)}
                    target="_blank"
                    rel="noopener"
                    className="group flex flex-col h-full border border-rule rounded-2xl overflow-hidden bg-paper-light hover:border-terra transition"
                  >
                    {/* Hero thumbnail — 600w card variant, ~20-30 KB WebP,
                        served from pettranslator.ai CDN. Lazy + async
                        decoding so it doesn't compete with the analysis
                        UI for first paint. */}
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
                    {/* flex-1 makes the text block fill remaining height
                        so all cards match the tallest title. */}
                    <div className="p-4 flex-1">
                      {/* Tighter label: text-[10px] + tracking-[0.15em]
                          gives it a proper editorial micro-caption feel
                          instead of the old chunky text-xs. */}
                      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-soft mb-2">
                        {a.category.replace(/-/g, " ")} · {a.readingTime}
                      </p>
                      {/* Mobile: text-lg (18px) since cards are full-width
                          and titles can easily wrap to 2 lines without
                          feeling cramped. Desktop sm+: text-[15px] keeps
                          3-column cards compact. */}
                      <h3 className="!font-serif !text-lg sm:!text-[15px] !leading-snug !font-normal text-ink group-hover:text-terra transition">
                        {a.title}
                      </h3>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      {/* CTAS */}
      <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-rule">
        <Link href="/analyze" className="btn w-full sm:w-auto justify-center">
          Analyze another →
        </Link>
        <Link href="/dashboard" className="btn btn-light w-full sm:w-auto justify-center">
          Back to dashboard
        </Link>
      </div>

      {/* FOOTER METADATA */}
      <p className="label mt-12 text-xs text-slate-soft">
        Model · {data.model} · prompt v{data.prompt_version} · {data.duration_ms}ms
      </p>
    </main>
  );
}

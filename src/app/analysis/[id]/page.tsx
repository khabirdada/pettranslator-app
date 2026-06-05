"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

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
      translation: string;
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
 * Map a 40-95 numeric confidence into a perceptually accurate label.
 * Solves the "78% sounds weak" psychology problem: users read 78% as "the
 * AI is unsure", even though the calibration rubric makes it a confident
 * read. We surface the *tier* first, percent as supporting evidence.
 */
function confidenceLabel(score: number): { tier: string; tone: "terra" | "slate" } {
  if (score >= 90) return { tier: "Very High", tone: "terra" };
  if (score >= 75) return { tier: "High", tone: "terra" };
  if (score >= 60) return { tier: "Moderate", tone: "slate" };
  return { tier: "Lower", tone: "slate" };
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
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <p className="label mb-4">§ Error</p>
        <h1 className="mb-6">Something <em className="text-terra">broke</em>.</h1>
        <p className="text-slate">Code: <span className="font-mono">{error}</span></p>
        <Link href="/dashboard" className="btn mt-8">← Back to dashboard</Link>
      </main>
    );
  }

  if (!data || data.status === "pending" || data.status === "processing") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <p className="label mb-4">§ Live analysis</p>
        <h1 className="mb-6">
          Reading the <em className="text-terra">signals</em>…
        </h1>
        <p className="text-slate mb-10 max-w-prose leading-relaxed">
          {data?.status === "processing"
            ? "Tail carriage, ear angle, jaw tension, posture, weight distribution. The AI is checking the same markers a board-certified behaviorist would — in about ten seconds."
            : "Your image is queued. The AI starts examining it in under ten seconds."}
        </p>
        <p className="label">
          Status · {data?.status ?? "pending"} · {polls} {polls === 1 ? "check" : "checks"}
        </p>
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
            <>We couldn&apos;t <em className="text-terra">read</em> this image.</>
          )}
        </h1>
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

  // Cap visible markers at 5; accordion reveals the rest.
  const VISIBLE_MARKER_CAP = 5;
  const markersToShow = showAllMarkers
    ? r.observed_markers
    : r.observed_markers.slice(0, VISIBLE_MARKER_CAP);
  const hiddenMarkerCount = r.observed_markers.length - VISIBLE_MARKER_CAP;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 sm:py-20">
      {/* HEADER — emotional state + confidence chip inline */}
      <p className="label mb-3">§ Report · {r.species}</p>
      <h1 className="mb-2 text-3xl sm:text-4xl">
        {r.emotional_state.split(" ").slice(0, -1).join(" ")}{" "}
        <em className="text-terra">
          {r.emotional_state.split(" ").slice(-1)[0]}.
        </em>
      </h1>
      <div className="flex items-baseline gap-2 mb-10">
        <span className="label">Confidence</span>
        <span className={`font-serif text-lg ${conf.tone === "terra" ? "text-terra" : "text-slate"}`}>
          {conf.tier}
        </span>
        <span className="text-xs text-slate-soft font-mono">
          · {r.confidence_score}% signal agreement
        </span>
      </div>

      {/* INSTANT OBSERVATIONS — the 2-second dopamine hit (v1.1+ only) */}
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

      {/* DECODED INTENT — narrower prose width per ChatGPT design crit */}
      <section className="mb-10">
        <p className="label mb-2">Decoded intent</p>
        <blockquote className="font-serif italic text-xl leading-relaxed border-l-2 border-terra pl-5 max-w-xl">
          “{r.translation}”
        </blockquote>
      </section>

      {/* OWNER ACTION PLAN — moved ABOVE evidence per ChatGPT critique:
          users care "what should I do" before "biomechanical explanation" */}
      <section className="mb-10">
        <p className="label mb-2">What to do</p>
        <p className="text-ink text-base leading-relaxed max-w-prose">
          {r.owner_action_plan}
        </p>
      </section>

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

      {/* NOT OBSERVED — occlusion awareness, builds trust (v1.1+ only) */}
      {r.not_observed && r.not_observed.length > 0 && (
        <section className="mb-10">
          <p className="label mb-2">What we couldn&apos;t confidently observe</p>
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

      {/* CONFIDENCE RATIONALE — collapsed by default, accordion */}
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

      {/* CTAS */}
      <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-rule">
        <Link href="/analyze" className="btn w-full sm:w-auto justify-center">
          Analyze another →
        </Link>
        <Link href="/dashboard" className="btn btn-light w-full sm:w-auto justify-center">
          Back to dashboard
        </Link>
      </div>

      {/* FOOTER METADATA — subtle, technical, builds rigor signal */}
      <p className="label mt-12 text-xs text-slate-soft">
        Model · {data.model} · prompt v{data.prompt_version} · {data.duration_ms}ms
      </p>
    </main>
  );
}

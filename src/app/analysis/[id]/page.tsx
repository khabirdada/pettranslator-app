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

export default function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);

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
        <p className="label mb-4">§ Working</p>
        <h1 className="mb-6">
          Reading the <em className="text-terra">signals</em>…
        </h1>
        <p className="text-slate mb-2">
          {data?.status === "processing"
            ? "The AI is documenting biometric markers."
            : "Your image is queued. The AI usually starts within ten seconds."}
        </p>
        <p className="label mt-8">
          Status · {data?.status ?? "pending"} · {polls} {polls === 1 ? "check" : "checks"}
        </p>
      </main>
    );
  }

  if (data.status === "failed") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <p className="label mb-4">§ Failed</p>
        <h1 className="mb-6">We couldn&apos;t finish that one.</h1>
        <p className="text-slate">
          The analysis hit an unrecoverable error after multiple retries.
        </p>
        <Link href="/analyze" className="btn mt-8">Try another image →</Link>
      </main>
    );
  }

  const output = data.result_json as AnalysisOutput;

  if (data.status === "refused" || output?.result_type === "refusal") {
    const refusal = output as Extract<AnalysisOutput, { result_type: "refusal" }>;
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <p className="label mb-4">§ Cannot analyze</p>
        <h1 className="mb-6">
          {refusal.refusal_code === "veterinary_referral_required"
            ? <>Please see your <em className="text-terra">vet</em>.</>
            : <>This image <em className="text-terra">won&apos;t</em> work.</>}
        </h1>
        <p className="text-slate text-lg leading-relaxed mb-6 max-w-prose">
          {refusal.user_message}
        </p>
        <p className="label mb-2">What to do next</p>
        <p className="text-slate mb-8 max-w-prose">{refusal.recommended_next_step}</p>
        <Link href="/analyze" className="btn">Try another image →</Link>
      </main>
    );
  }

  // Complete + analysis result
  const r = output as Extract<AnalysisOutput, { result_type: "analysis" }>;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
      <p className="label mb-4">
        § Report · {r.species} · {r.confidence_score}% confidence
      </p>
      <h1 className="mb-6">
        {r.emotional_state.split(" ").slice(0, -1).join(" ")}{" "}
        <em className="text-terra">
          {r.emotional_state.split(" ").slice(-1)[0]}.
        </em>
      </h1>

      <p className="label mb-2">Decoded intent</p>
      <blockquote className="font-serif italic text-xl leading-relaxed mb-8 max-w-prose border-l-2 border-terra pl-5">
        “{r.translation}”
      </blockquote>

      <div className="grid sm:grid-cols-2 gap-8 mb-10">
        <div>
          <p className="label mb-2">Observed biometric cues</p>
          <ol className="space-y-2 text-sm">
            {r.observed_markers.map((m, i) => (
              <li key={i} className="font-mono flex gap-3">
                <span className="text-terra">{String(i + 1).padStart(2, "0")}</span>
                <span>{m}</span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <p className="label mb-2">Owner action plan</p>
          <p className="text-slate text-sm leading-relaxed">{r.owner_action_plan}</p>
        </div>
      </div>

      {r.refer_to_professional && (
        <div className="border border-terra rounded-2xl p-6 mb-10 bg-paper-light">
          <p className="label mb-2" style={{ color: "var(--terra)" }}>
            Behaviorist referral
          </p>
          <p className="text-sm text-ink">
            This analysis involves behaviors that benefit from a
            positive-reinforcement professional (look for CSAT, CDBC, or Fear
            Free credentials). Don&apos;t attempt self-help protocols for
            aggression, severe separation distress, or stereotypic behavior.
          </p>
        </div>
      )}

      <p className="label mb-4">Confidence rationale</p>
      <p className="text-slate text-sm mb-10 max-w-prose">{r.confidence_rationale}</p>

      <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-rule">
        <Link href="/analyze" className="btn w-full sm:w-auto justify-center">
          Analyze another →
        </Link>
        <Link href="/dashboard" className="btn btn-light w-full sm:w-auto justify-center">
          Back to dashboard
        </Link>
      </div>

      <p className="label mt-12 text-xs">
        Model · {data.model} · prompt v{data.prompt_version} · {data.duration_ms}ms
      </p>
    </main>
  );
}

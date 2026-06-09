"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

type SubmitState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "analyzing" }
  | { kind: "error"; message: string }
  | {
      kind: "rate_limited";
      message: string;
      tier: "free" | "premium" | "tester";
      upgradeUrl: string | null;
      title: string;
    };

// Elapsed-seconds thresholds for progressive UI messaging.
// Anchored to the actual Vercel maxDuration (60s) and the
// typical Claude latency band (6–15s).
const ELAPSED_LONG = 15;     // "taking longer than usual"
const ELAPSED_ALMOST = 45;   // "almost there"
const ELAPSED_TIMEOUT = 65;  // assume function dead, surface recovery

export default function AnalyzePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [elapsedSec, setElapsedSec] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tick an elapsed-seconds counter whenever an in-flight request is open.
  // Drives the progressive "this is taking longer…" / hard-timeout
  // messaging without a per-render setInterval rebind.
  useEffect(() => {
    if (state.kind !== "uploading" && state.kind !== "analyzing") {
      setElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [state.kind]);

  // Hard timeout: if we exceed ELAPSED_TIMEOUT without a server response,
  // the Vercel function has almost certainly been killed. Move to an
  // error state so the user gets a recovery action instead of a spinner
  // that will never resolve.
  useEffect(() => {
    if (state.kind !== "analyzing") return;
    if (elapsedSec < ELAPSED_TIMEOUT) return;
    setState({
      kind: "error",
      message:
        "The analysis didn't complete in time. Your image was saved — try again, or check your dashboard in a minute (the result may still arrive).",
    });
  }, [elapsedSec, state.kind]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
    setState({ kind: "idle" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setState({ kind: "uploading" });
    try {
      // 1) Ask the server for a signed upload URL
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime: file.type, size: file.size }),
      });
      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({}));
        throw new Error(err.error ?? `upload_url_${urlRes.status}`);
      }
      const { uploadUrl, storagePath } = (await urlRes.json()) as {
        uploadUrl: string;
        storagePath: string;
      };

      // 2) Upload directly to Supabase Storage (browser → CDN, skips Vercel)
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`storage_put_${putRes.status}`);
      }

      // 3) Tell our API to enqueue the analysis job
      setState({ kind: "analyzing" });
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, userContext: context.trim() }),
      });

      // Specific handling for 402 (rate-limit hit)
      if (analyzeRes.status === 402) {
        const err = (await analyzeRes.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          tier?: "free" | "premium" | "tester";
          upgradeUrl?: string | null;
        };
        // Map the reason code to a human-readable section title.
        // Different from the body message — this is the 1-line headline.
        const titleByReason: Record<string, string> = {
          free_quota_exhausted: "Free analyses used",
          monthly_limit_reached: "Monthly quota reached",
          daily_safety_ceiling: "Daily safety ceiling",
          global_daily_ceiling: "Site at capacity",
        };
        setState({
          kind: "rate_limited",
          message: err.message ?? "You've reached your usage limit.",
          tier: err.tier ?? "free",
          upgradeUrl: err.upgradeUrl ?? null,
          title: (err.error && titleByReason[err.error]) ?? "Limit reached",
        });
        return;
      }

      if (!analyzeRes.ok) {
        const err = await analyzeRes.json().catch(() => ({}));
        throw new Error(err.error ?? `analyze_${analyzeRes.status}`);
      }
      const { analysisId } = (await analyzeRes.json()) as { analysisId: string };

      // 4) Redirect to the result page — polling kicks in there
      router.push(`/analysis/${analysisId}`);
    } catch (err) {
      console.error(err);
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "unknown_error",
      });
    }
  }

  const submitting = state.kind === "uploading" || state.kind === "analyzing";

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 sm:py-20">
      <p className="label mb-4">§ New analysis</p>
      <h1 className="mb-6">
        Show me your <em className="text-terra">pet</em>.
      </h1>
      <p className="text-slate mb-8 max-w-prose">
        Upload a clear image of your dog or cat. Video coming after launch —
        for now, a single representative photo.
      </p>

      {/* Best-results checklist — improves output quality before the user uploads */}
      <div className="mb-10 border border-rule rounded-2xl p-5 bg-paper-light">
        <p className="label mb-3">Best results from</p>
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          {[
            "Eyes visible",
            "Ears visible",
            "Full body if possible",
            "Natural lighting",
            "No motion blur",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2 text-ink">
              <span className="text-terra font-mono text-xs">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* File picker */}
        <div>
          <label className="label mb-2 block">Image · jpg, png, webp, heic</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={onFileChange}
            disabled={submitting}
            className="block w-full text-sm text-slate file:mr-4 file:py-2.5 file:px-5 file:rounded-full file:border-0 file:bg-ink file:text-paper-light file:font-medium file:cursor-pointer file:hover:bg-terra"
          />
        </div>

        {previewUrl && (
          <div className="border border-rule rounded-2xl overflow-hidden bg-paper-light">
            <img src={previewUrl} alt="" className="w-full h-auto block max-h-96 object-contain" />
          </div>
        )}

        {/* Context input */}
        <div>
          <label htmlFor="context" className="label mb-2 block">
            Context · one sentence, optional but recommended
          </label>
          <textarea
            id="context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            disabled={submitting}
            placeholder="e.g. Whining at the front door this morning."
            rows={3}
            maxLength={240}
            className="input"
            style={{ minHeight: 88 }}
          />
          {/* Ghost examples — kills the blank-page freeze on context field.
              Plain text, not buttons — keeps the editorial aesthetic. */}
          <p className="mt-2 text-xs text-slate-soft leading-relaxed">
            Try: <span className="text-slate">barking at visitors today</span>
            {" · "}<span className="text-slate">restless after the walk</span>
            {" · "}<span className="text-slate">suddenly hiding under the bed</span>
            {" · "}<span className="text-slate">new rescue, first day home</span>
          </p>
          <p className="mt-1 text-xs text-slate-soft">
            {context.length}/240 — the AI weighs context but the physical signals lead.
          </p>
        </div>

        <button
          type="submit"
          disabled={!file || submitting}
          className="btn w-full justify-center"
        >
          {state.kind === "uploading" && "Uploading…"}
          {state.kind === "analyzing" && "Reading behavioral signals…"}
          {(state.kind === "idle" || state.kind === "error") && "Analyze →"}
        </button>

        {/* Progressive elapsed-time feedback while submitting. Sets a
            realistic expectation (Claude takes 6–15s typical, can stretch
            to 30s+ for video) so the user doesn't bounce thinking it
            crashed. Hard timeout at ELAPSED_TIMEOUT routes to the error
            block below with a recovery action. */}
        {submitting && (
          <div className="text-sm text-slate-soft font-mono">
            <div className="flex items-center gap-3">
              <span className="inline-block size-2 rounded-full bg-terra animate-pulse" />
              <span>
                {state.kind === "uploading"
                  ? `Uploading · ${elapsedSec}s`
                  : `Analyzing · ${elapsedSec}s`}
              </span>
            </div>
            {state.kind === "analyzing" && elapsedSec >= ELAPSED_LONG && elapsedSec < ELAPSED_ALMOST && (
              <p className="mt-2 text-slate leading-relaxed">
                Taking a little longer than usual — typical runs finish in 6–15s.
                We&rsquo;ll keep waiting.
              </p>
            )}
            {state.kind === "analyzing" && elapsedSec >= ELAPSED_ALMOST && (
              <p className="mt-2 text-slate leading-relaxed">
                Almost there. If we don&rsquo;t hear back by{" "}
                <span className="text-ink font-semibold">{ELAPSED_TIMEOUT}s</span>{" "}
                we&rsquo;ll save your upload and you can retry — nothing is lost.
              </p>
            )}
          </div>
        )}

        {state.kind === "error" && (
          <div className="border border-terra/40 rounded-2xl p-5 bg-paper-light text-sm">
            <p className="text-terra font-medium mb-2">Something went wrong</p>
            <p className="text-ink leading-relaxed mb-3">{state.message}</p>
            <p className="text-slate-soft text-xs">
              Still stuck? Email{" "}
              <a
                href="mailto:hello@pettranslator.ai"
                className="text-terra underline hover:no-underline"
              >
                hello@pettranslator.ai
              </a>{" "}
              and we&rsquo;ll look at it personally.
            </p>
          </div>
        )}

        {state.kind === "rate_limited" && (
          <div className="border border-terra rounded-2xl p-6 bg-paper-light">
            <p className="label mb-2" style={{ color: "var(--terra)" }}>
              {state.title}
            </p>
            <p className="text-sm text-ink leading-relaxed mb-4">{state.message}</p>
            {state.upgradeUrl && (
              <a href={state.upgradeUrl} className="btn">
                {state.tier === "free" ? "Upgrade to Premium →" : "See your options →"}
              </a>
            )}
          </div>
        )}
      </form>
    </main>
  );
}

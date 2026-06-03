"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

type SubmitState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "analyzing" }
  | { kind: "error"; message: string }
  | { kind: "rate_limited"; message: string; tier: "free" | "premium"; upgradeUrl: string | null };

export default function AnalyzePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          message?: string;
          tier?: "free" | "premium";
          upgradeUrl?: string | null;
        };
        setState({
          kind: "rate_limited",
          message: err.message ?? "Daily limit reached.",
          tier: err.tier ?? "free",
          upgradeUrl: err.upgradeUrl ?? null,
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
      <p className="text-slate mb-10 max-w-prose">
        Upload a clear image of your dog or cat. The clearer the lighting and
        framing, the more confident the analysis. Video coming after launch —
        for now, a single representative photo.
      </p>

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
          {state.kind === "analyzing" && "Queueing analysis…"}
          {(state.kind === "idle" || state.kind === "error") && "Analyze →"}
        </button>

        {state.kind === "error" && (
          <p className="text-sm text-terra">
            Something went wrong: {state.message}. Try again or email{" "}
            <a href="mailto:hello@pettranslator.ai" className="underline">hello@pettranslator.ai</a>.
          </p>
        )}

        {state.kind === "rate_limited" && (
          <div className="border border-terra rounded-2xl p-6 bg-paper-light">
            <p className="label mb-2" style={{ color: "var(--terra)" }}>
              Daily limit reached
            </p>
            <p className="text-sm text-ink leading-relaxed mb-4">{state.message}</p>
            {state.upgradeUrl && state.tier === "free" && (
              <a href={state.upgradeUrl} className="btn">Upgrade to Premium →</a>
            )}
          </div>
        )}
      </form>
    </main>
  );
}

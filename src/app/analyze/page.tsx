"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  extractFramesFromVideo,
  isVideoFile,
  releaseFramePreviews,
  VIDEO_MIME_TYPES,
  type ExtractedFrame,
} from "@/lib/extract-frames";
import { PetPicker } from "@/components/PetPicker";

const VIDEO_FRAME_COUNT = 5;
const MAX_VIDEO_DURATION_SEC = 30;

type SubmitState =
  | { kind: "idle" }
  | { kind: "extracting" } // video → 5 frames in the browser
  | { kind: "uploading" }
  | { kind: "analyzing" }
  | { kind: "error"; message: string }
  | {
      kind: "rate_limited";
      message: string;
      tier: "free" | "premium" | "pro" | "tester";
      upgradeUrl: string | null;
      title: string;
    };

type MediaKind = "image" | "video";

// Convert known extract-frames error codes to friendly messages.
function videoErrorMessage(code: string): string {
  switch (code) {
    case "video_too_long":
      return `Video is longer than ${MAX_VIDEO_DURATION_SEC} seconds. Trim it first — the AI works best on short clips.`;
    case "video_decode_failed":
      return "Your browser couldn't decode this video format. Try .mp4 (H.264) or .mov from iPhone.";
    case "video_empty":
      return "That video file appears empty or corrupt. Try a different clip.";
    case "video_seek_failed":
      return "Frame extraction stalled. Try a smaller clip (under 15 seconds) or a different file.";
    default:
      return `Couldn't process the video (${code}). Try a different clip or use a still image.`;
  }
}

// Elapsed-seconds thresholds for progressive UI messaging.
// Anchored to the actual Vercel maxDuration (60s) and the
// typical Claude latency band (6–15s).
const ELAPSED_LONG = 15;     // "taking longer than usual"
const ELAPSED_ALMOST = 45;   // "almost there"
const ELAPSED_TIMEOUT = 65;  // assume function dead, surface recovery

export default function AnalyzePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mediaKind, setMediaKind] = useState<MediaKind>("image");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // For video uploads: 5 extracted JPEG frames + their preview URLs.
  // Released on unmount or when the user picks a new file.
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [context, setContext] = useState("");
  // Optional pet-profile selection. null = "no pet"; the analyze route
  // handles null petId identically to how it did before this feature
  // existed, so users who Skip lose nothing.
  const [petId, setPetId] = useState<string | null>(null);
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [elapsedSec, setElapsedSec] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up any blob URLs we created when the component unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      releaseFramePreviews(frames);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Release any previous previews before swapping
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    releaseFramePreviews(frames);
    setFrames([]);

    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
    setMediaKind(f && isVideoFile(f) ? "video" : "image");
    setState({ kind: "idle" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    try {
      // For video, extract frames CLIENT-SIDE first. Claude doesn't accept
      // raw video; we send a sequence of 5 JPEG frames as a multi-image
      // message. Frame extraction takes ~1-3s per second of source video
      // on a phone, so we surface the 'extracting' state to the user.
      let extractedFrames = frames;
      if (mediaKind === "video" && frames.length === 0) {
        setState({ kind: "extracting" });
        try {
          extractedFrames = await extractFramesFromVideo(file, {
            frameCount: VIDEO_FRAME_COUNT,
            maxDurationSec: MAX_VIDEO_DURATION_SEC,
          });
          setFrames(extractedFrames);
        } catch (err) {
          const code = (err as { code?: string })?.code ?? "video_decode_failed";
          setState({ kind: "error", message: videoErrorMessage(code) });
          return;
        }
      }

      // What we upload depends on media kind:
      //   image → 1 file, original
      //   video → 5 files, the extracted JPEG frames
      const uploadPayloads: { mime: string; size: number; data: Blob }[] =
        mediaKind === "video"
          ? extractedFrames.map((f) => ({
              mime: "image/jpeg",
              size: f.blob.size,
              data: f.blob,
            }))
          : [{ mime: file.type, size: file.size, data: file }];

      setState({ kind: "uploading" });

      // 1) Sign N upload URLs in one round-trip
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mime: uploadPayloads[0].mime,
          size: uploadPayloads[0].size,
          count: uploadPayloads.length,
        }),
      });
      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({}));
        throw new Error(err.error ?? `upload_url_${urlRes.status}`);
      }
      const urlJson = (await urlRes.json()) as
        | { uploadUrl: string; storagePath: string }
        | { uploadUrls: string[]; storagePaths: string[] };

      const uploadUrls =
        "uploadUrls" in urlJson ? urlJson.uploadUrls : [urlJson.uploadUrl];
      const storagePaths =
        "storagePaths" in urlJson ? urlJson.storagePaths : [urlJson.storagePath];

      // 2) Upload all blobs in parallel (browser → Supabase Storage, skips Vercel)
      await Promise.all(
        uploadPayloads.map(async (p, i) => {
          const putRes = await fetch(uploadUrls[i], {
            method: "PUT",
            headers: { "Content-Type": p.mime },
            body: p.data,
          });
          if (!putRes.ok) throw new Error(`storage_put_${putRes.status}`);
        }),
      );

      // 3) Tell our API to enqueue the analysis job
      setState({ kind: "analyzing" });
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mediaKind === "video"
            ? { framePaths: storagePaths, userContext: context.trim(), petId }
            : { storagePath: storagePaths[0], userContext: context.trim(), petId },
        ),
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

  const submitting =
    state.kind === "extracting" ||
    state.kind === "uploading" ||
    state.kind === "analyzing";

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 sm:py-20">
      <p className="label mb-4">§ New analysis</p>
      <h1 className="mb-6">
        Show me your <em className="text-terra">pet</em>.
      </h1>
      <p className="text-slate mb-8 max-w-prose">
        Upload a clear photo or a short video (≤{MAX_VIDEO_DURATION_SEC}s) of
        your dog or cat. For video we extract {VIDEO_FRAME_COUNT} frames in your
        browser and analyze them as a temporal sequence — your file never leaves
        your device unless you submit.
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
        {/* Pet picker — inline capture. Sits above the file picker so
            the user tags the analysis with a pet before uploading, not
            after. Default is "None" — zero friction for users who
            don't want a saved profile. Sends petId in the analyze POST. */}
        <PetPicker value={petId} onChange={setPetId} disabled={submitting} />

        {/* File picker — accepts both image AND video. Mobile browsers
            surface both camera-roll types when we list both groups. */}
        <div>
          <label className="label mb-2 block">
            Image or video · jpg, png, webp, heic, mp4, mov
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept={[
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/heic",
              "image/heif",
              ...VIDEO_MIME_TYPES,
            ].join(",")}
            onChange={onFileChange}
            disabled={submitting}
            className="block w-full text-sm text-slate file:mr-4 file:py-2.5 file:px-5 file:rounded-full file:border-0 file:bg-ink file:text-paper-light file:font-medium file:cursor-pointer file:hover:bg-terra"
          />
        </div>

        {/* Preview — image rendered as <img>, video as <video controls
            muted playsInline> so users can scrub before submitting. */}
        {previewUrl && mediaKind === "image" && (
          <div className="border border-rule rounded-2xl overflow-hidden bg-paper-light">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="w-full h-auto block max-h-96 object-contain" />
          </div>
        )}
        {previewUrl && mediaKind === "video" && (
          <div className="border border-rule rounded-2xl overflow-hidden bg-paper-light">
            <video
              src={previewUrl}
              controls
              muted
              playsInline
              className="w-full h-auto block max-h-96 object-contain"
            />
            <p className="px-4 py-3 text-xs text-slate-soft font-mono border-t border-rule">
              {VIDEO_FRAME_COUNT} frames will be extracted in your browser
              {frames.length > 0 ? " — done" : " on submit"}.
            </p>
          </div>
        )}

        {/* Frame strip — shown after extraction so the user sees exactly
            what the AI receives. Builds trust ("this is the data") +
            quality control ("if the frames look bad, try again"). */}
        {frames.length > 0 && (
          <div>
            <p className="label mb-2">Frames the AI will see</p>
            <ul className="grid grid-cols-5 gap-2">
              {frames.map((f) => (
                <li
                  key={f.index}
                  className="aspect-video border border-rule rounded-lg overflow-hidden bg-paper-light"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.previewUrl}
                    alt={`Frame ${f.index + 1} at ${f.timestampSec.toFixed(1)}s`}
                    className="w-full h-full object-cover"
                  />
                </li>
              ))}
            </ul>
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
          {state.kind === "extracting" && "Extracting frames…"}
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
                {state.kind === "extracting"
                  ? `Extracting frames · ${elapsedSec}s`
                  : state.kind === "uploading"
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

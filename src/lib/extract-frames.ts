// Client-side video frame extraction.
//
// Claude Sonnet 4.6 doesn't accept raw video, but it CAN reason across
// multiple still images in a single message. So we extract N frames
// evenly spaced across the user's video, upload them as separate JPEGs,
// and send them all to Claude as image content blocks in one analyze
// request. The model treats them as a temporal sequence (per prompt v1.3).
//
// Why client-side: Vercel functions don't have ffmpeg and the
// WASM ffmpeg port is heavy enough (~25 MB) that it tanks cold-start
// and exceeds the function memory budget for a 30-second video. The
// browser's HTMLVideoElement already does the decoding for free.
//
// Browser support: Chrome/Edge/Firefox/Safari 16+. iOS Safari needs
// `playsInline` and a one-time user gesture before seek works reliably.
// HEVC (.mov from iPhone) decodes natively in Safari and Chrome 107+.

export interface ExtractedFrame {
  /** Frame index, 0-based. */
  index: number;
  /** Timestamp in the source video, in seconds. */
  timestampSec: number;
  /** JPEG blob, q=82, target ~1280×720 max dimension. */
  blob: Blob;
  /** Object URL for preview thumbnails. Caller revokes when done. */
  previewUrl: string;
}

export interface ExtractFramesOptions {
  /** How many frames to extract. 5 is the sweet spot for ≤15s clips. */
  frameCount?: number;
  /** Max video duration to accept, seconds. Reject anything longer. */
  maxDurationSec?: number;
  /** Longest edge of each output frame (pixels). 1280 is plenty for
   *  Claude's vision encoder; larger wastes upload bandwidth. */
  maxEdgePx?: number;
  /** JPEG quality 0–1. 0.82 is the WebP-equivalent visual sweet spot. */
  jpegQuality?: number;
}

const DEFAULTS: Required<ExtractFramesOptions> = {
  frameCount: 5,
  maxDurationSec: 30,
  maxEdgePx: 1280,
  jpegQuality: 0.82,
};

/**
 * Decode a user's video file and return N frames as JPEG blobs.
 *
 * Throws with a stable .code string on user-actionable failures so the
 * UI can show a friendly message:
 *   - 'video_too_long'      — duration > maxDurationSec
 *   - 'video_decode_failed' — browser couldn't decode (codec issue)
 *   - 'video_empty'         — duration is 0 or NaN
 *   - 'video_seek_failed'   — seek timed out (rare; phone storage stalls)
 */
export async function extractFramesFromVideo(
  file: File,
  opts: ExtractFramesOptions = {},
): Promise<ExtractedFrame[]> {
  const o = { ...DEFAULTS, ...opts };

  // Create a hidden <video> element. muted+playsInline required for
  // mobile autoplay/seek without a click gesture. We never .play() —
  // only .currentTime = X to seek.
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  // The source has to be a blob URL — File doesn't go directly into src.
  const blobUrl = URL.createObjectURL(file);
  video.src = blobUrl;

  try {
    // Wait for metadata so we know duration + dimensions.
    await new Promise<void>((resolve, reject) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
      video.addEventListener(
        "error",
        () => reject(asError("video_decode_failed")),
        { once: true },
      );
      // Safari sometimes never fires loadedmetadata for unsupported codecs.
      setTimeout(() => reject(asError("video_decode_failed")), 8000);
    });

    const duration = video.duration;
    if (!isFinite(duration) || duration <= 0) {
      throw asError("video_empty");
    }
    if (duration > o.maxDurationSec) {
      throw asError("video_too_long");
    }

    // Compute frame timestamps. Evenly distributed across the duration,
    // skipping the very-first and very-last frames (those often catch
    // black-frame artifacts from device encoders).
    const margin = Math.min(0.2, duration * 0.05);
    const usable = duration - margin * 2;
    const timestamps = Array.from({ length: o.frameCount }, (_, i) => {
      if (o.frameCount === 1) return duration / 2;
      const frac = i / (o.frameCount - 1);
      return margin + frac * usable;
    });

    // Pick canvas dimensions that scale the longest edge to maxEdgePx
    // and preserve aspect ratio. Round to even pixels so JPEG quantize
    // doesn't introduce subpixel artifacts.
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    if (srcW === 0 || srcH === 0) throw asError("video_decode_failed");
    const scale = Math.min(1, o.maxEdgePx / Math.max(srcW, srcH));
    const dstW = Math.round((srcW * scale) / 2) * 2;
    const dstH = Math.round((srcH * scale) / 2) * 2;

    // One canvas reused for each frame — allocation cost is real on phones.
    const canvas = document.createElement("canvas");
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw asError("video_decode_failed");

    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i];
      await seekVideo(video, t);
      ctx.drawImage(video, 0, 0, dstW, dstH);
      const blob = await canvasToJpeg(canvas, o.jpegQuality);
      frames.push({
        index: i,
        timestampSec: t,
        blob,
        previewUrl: URL.createObjectURL(blob),
      });
    }

    return frames;
  } finally {
    // Always release the blob URL to free memory — videos are big.
    URL.revokeObjectURL(blobUrl);
    video.src = "";
  }
}

/**
 * Seek the video to the given timestamp and resolve when the frame
 * has actually painted. The 'seeked' event alone isn't enough on
 * some browsers — we also wait one rAF tick so drawImage gets the
 * new frame instead of the previous one.
 */
function seekVideo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      // One rAF so the frame is definitely in the compositor.
      requestAnimationFrame(() => resolve());
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = Math.max(0, Math.min(t, video.duration - 0.01));
    // 5s hard cap per seek — phones with stalled storage will hang
    // indefinitely otherwise.
    setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      reject(asError("video_seek_failed"));
    }, 5000);
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(asError("video_decode_failed"))),
      "image/jpeg",
      q,
    );
  });
}

function asError(code: string): Error & { code: string } {
  const e = new Error(code) as Error & { code: string };
  e.code = code;
  return e;
}

/**
 * Release the preview-URL handles attached to extracted frames.
 * Call this after the user submits or navigates away.
 */
export function releaseFramePreviews(frames: ExtractedFrame[]): void {
  for (const f of frames) URL.revokeObjectURL(f.previewUrl);
}

/**
 * Allowed video MIME types. mov/quicktime is iPhone's default; webm
 * is desktop screen-record territory; mp4 is the universal fallback.
 */
export const VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/quicktime", // .mov
  "video/webm",
  "video/x-matroska", // .mkv — rare but cheap to allow
];

export function isVideoFile(file: File): boolean {
  // Some browsers report .mov as "" mime — fall back to extension check.
  if (file.type && VIDEO_MIME_TYPES.includes(file.type)) return true;
  if (/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)) return true;
  return false;
}

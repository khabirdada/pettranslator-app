// POST /api/upload-url
// Returns 1..N signed Supabase Storage PUT URLs the browser can upload
// directly to. One round-trip regardless of how many frames the client
// wants to upload (videos extract to 5 frames each).
//
// Body:
//   { mime: "image/jpeg", size: 12345 }       → 1 URL (legacy single-image)
//   { count: 5, mime: "image/jpeg", size: 8 } → 5 URLs (video frames)
//
// Returns:
//   { storagePath, uploadUrl }              for single
//   { storagePaths: string[], uploadUrls: string[] }   for batch
//
// Image MIMEs only — the browser does video decoding + frame extraction
// upstream, so by the time we sign URLs, every payload is a JPEG.

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const MAX_BYTES_PER_FILE = 50 * 1024 * 1024; // 50 MB
const MAX_BATCH_COUNT = 8; // 5 is the spec; 8 is the hard cap
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function extFor(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic") return "heic";
  if (mime === "image/heif") return "heif";
  return "bin";
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { mime?: string; size?: number; count?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const mime = String(body.mime || "").toLowerCase();
  const size = Number(body.size || 0);
  const count = Number.isFinite(body.count) ? Math.floor(body.count!) : 1;

  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: "unsupported_mime", allowed: [...ALLOWED_MIME] },
      { status: 415 },
    );
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES_PER_FILE) {
    return NextResponse.json(
      { error: "file_too_large", maxBytes: MAX_BYTES_PER_FILE },
      { status: 413 },
    );
  }
  if (count < 1 || count > MAX_BATCH_COUNT) {
    return NextResponse.json(
      { error: "invalid_count", maxBatch: MAX_BATCH_COUNT },
      { status: 400 },
    );
  }

  // Pre-generate all paths so the client knows where each frame will land.
  // Group video frames under a single uuid prefix so they cluster in
  // Storage browser and can be deleted as a unit.
  const groupId = crypto.randomUUID();
  const ext = extFor(mime);
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const filename =
      count === 1
        ? `${groupId}.${ext}`
        : `${groupId}/frame-${String(i + 1).padStart(2, "0")}.${ext}`;
    paths.push(`${user.id}/${filename}`);
  }

  // Sign all in parallel. Service role required — Storage RLS would
  // block the anon client from creating signed upload URLs.
  const svc = createServiceClient();
  const signed = await Promise.all(
    paths.map((p) => svc.storage.from("videos").createSignedUploadUrl(p)),
  );

  const failed = signed.find((r) => r.error || !r.data);
  if (failed) {
    console.error("signed_upload_url_failed", failed.error?.message);
    return NextResponse.json({ error: "signed_url_failed" }, { status: 500 });
  }

  // Maintain the legacy single-URL response shape for the existing
  // image-only call site; return an array for batch.
  if (count === 1) {
    return NextResponse.json({
      storagePath: paths[0],
      uploadUrl: signed[0].data!.signedUrl,
      token: signed[0].data!.token,
    });
  }
  return NextResponse.json({
    storagePaths: paths,
    uploadUrls: signed.map((s) => s.data!.signedUrl),
    tokens: signed.map((s) => s.data!.token),
  });
}

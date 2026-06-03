// POST /api/upload-url
// Returns a signed Supabase Storage PUT URL the browser can upload directly to.
// Removes the round-trip through Vercel for the actual image bytes.

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
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
  // Auth: must be a logged-in user
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { mime?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const mime = String(body.mime || "").toLowerCase();
  const size = Number(body.size || 0);
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: "unsupported_mime", allowed: [...ALLOWED_MIME] }, { status: 415 });
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large", maxBytes: MAX_BYTES }, { status: 413 });
  }

  // Create the storage path: videos/<userId>/<uuid>.<ext>
  const filename = `${crypto.randomUUID()}.${extFor(mime)}`;
  const storagePath = `${user.id}/${filename}`;

  // Use service role for the signed-URL operation (Storage RLS would otherwise block)
  const svc = createServiceClient();
  const { data, error } = await svc.storage
    .from("videos")
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error("signed_upload_url_failed", error?.message);
    return NextResponse.json({ error: "signed_url_failed" }, { status: 500 });
  }

  return NextResponse.json({
    storagePath,
    uploadUrl: data.signedUrl,
    token: data.token,
  });
}

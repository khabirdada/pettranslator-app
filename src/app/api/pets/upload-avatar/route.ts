// POST /api/pets/upload-avatar
//
// Mints a signed upload URL for a pet-avatar photo. Follows the same
// pattern as /api/upload-url but writes to a distinct namespace so
// analysis uploads and pet avatars can be lifecycle-managed
// independently (avatars survive across analyses; analyses expire).
//
// Storage layout:
//   videos/<userId>/pets/<uuid>.jpg
// The bucket is the same "videos" bucket (private, RLS-guarded) —
// only the path prefix differs.
//
// The client PUTs the file bytes to the signed URL, then PATCHes
// /api/pets/[id] with { photo_path } (or POSTs /api/pets with the
// photo_path in the create body).

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient, createClient } from "@/lib/supabase/server";

const BUCKET = "videos";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — avatars, not full-res photos
const ALLOWED = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function extForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic" || mime === "image/heif") return "heic";
  return "jpg";
}

// Small random suffix — collides at ~1 in 10^15 within a single user,
// which is more than enough while staying URL-safe.
function randSlug(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { mime?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const mime = String(body.mime ?? "").toLowerCase();
  const size = Number(body.size ?? 0);
  if (!ALLOWED.has(mime)) {
    return NextResponse.json({ error: "unsupported_mime", allowed: [...ALLOWED] }, { status: 400 });
  }
  if (!size || size > MAX_BYTES) {
    return NextResponse.json(
      { error: "size_out_of_range", maxBytes: MAX_BYTES },
      { status: 400 },
    );
  }

  const path = `${user.id}/pets/${randSlug()}.${extForMime(mime)}`;
  const svc = createServiceClient();
  const { data: signed, error } = await svc
    .storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !signed) {
    console.error("pet_avatar_sign_failed", error?.message);
    return NextResponse.json({ error: "sign_failed" }, { status: 500 });
  }

  return NextResponse.json({
    uploadUrl: signed.signedUrl,
    // storagePath is what we PATCH into pet_profiles.photo_path after
    // the client PUTs bytes to uploadUrl.
    storagePath: path,
    token: signed.token,
  });
}

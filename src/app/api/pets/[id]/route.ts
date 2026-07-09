// PATCH  /api/pets/[id]  — update a pet profile (name, breed, age, avatar).
// DELETE /api/pets/[id]  — remove a pet profile.
//
// Species is intentionally NOT patchable — a dog doesn't become a cat.
// If a user made a species mistake they should delete and re-add.
//
// Deletion behavior: the analyses.pet_id foreign key is ON DELETE SET
// NULL (see 0001_initial_schema.sql), so removing a pet preserves the
// user's analysis history — the affected analyses just lose their pet
// tag. This is the right tradeoff: users would be furious if deleting
// a pet also nuked months of behavioral reports about that pet.
//
// RLS enforces user_id = auth.uid() at the DB layer for reads, updates,
// and deletes on public.pet_profiles.

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const MAX_NAME_LEN = 40;
const MAX_BREED_LEN = 60;
const MAX_AGE_LEN = 30;

// Ensure the storage path we're about to store is one this user owns.
// Prevents a malicious client from setting photo_path to some other
// user's file. Paths are minted by /api/pets/upload-avatar and always
// prefixed with the user's own auth.uid.
function pathBelongsToUser(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`);
}

// -----------------------------------------------------------------------------
// PATCH — update
// -----------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    name?: string;
    breed?: string | null;
    approximate_age?: string | null;
    photo_path?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Build only the fields the caller actually sent. Empty strings for
  // breed/age/photo mean "clear" — normalize to null.
  const patch: Record<string, string | null> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, MAX_NAME_LEN);
    if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
    patch.name = name;
  }
  if (body.breed !== undefined) {
    const trimmed = body.breed === null ? "" : String(body.breed).trim().slice(0, MAX_BREED_LEN);
    patch.breed = trimmed || null;
  }
  if (body.approximate_age !== undefined) {
    const trimmed = body.approximate_age === null ? "" : String(body.approximate_age).trim().slice(0, MAX_AGE_LEN);
    patch.approximate_age = trimmed || null;
  }
  if (body.photo_path !== undefined) {
    if (body.photo_path === null || body.photo_path === "") {
      patch.photo_path = null;
    } else {
      const p = String(body.photo_path).trim();
      if (!pathBelongsToUser(p, user.id)) {
        return NextResponse.json({ error: "invalid_photo_path" }, { status: 400 });
      }
      patch.photo_path = p;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  // RLS enforces the user_id match on the update.
  const { data: pet, error } = await supabase
    .from("pet_profiles")
    .update(patch)
    .eq("id", id)
    .select("id, name, species, breed, approximate_age, photo_path, created_at")
    .single();

  if (error) {
    // The RLS-filter miss and "row not found" both surface as PGRST116 in
    // supabase-js — collapse both into a 404 so we don't leak existence.
    return NextResponse.json({ error: "not_found_or_forbidden" }, { status: 404 });
  }
  return NextResponse.json({ pet });
}

// -----------------------------------------------------------------------------
// DELETE
// -----------------------------------------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Ownership check first — RLS will also refuse but a pre-check gives us
  // an accurate 404 vs a silent no-op deletion.
  const { data: existing, error: selErr } = await supabase
    .from("pet_profiles")
    .select("id, photo_path")
    .eq("id", id)
    .maybeSingle();

  if (selErr || !existing) {
    return NextResponse.json({ error: "not_found_or_forbidden" }, { status: 404 });
  }

  const { error: delErr } = await supabase
    .from("pet_profiles")
    .delete()
    .eq("id", id);

  if (delErr) {
    console.error("pets_delete_failed", delErr.message);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  // Best-effort: also remove the avatar file from Storage. Not fatal if
  // it fails (orphaned files can be cleaned later); a 200 back to the
  // client keeps the UX snappy.
  if (existing.photo_path) {
    try {
      const svc = createServiceClient();
      await svc.storage.from("videos").remove([existing.photo_path]);
    } catch (e) {
      console.error("pet_avatar_orphan", e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true });
}

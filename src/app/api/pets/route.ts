// GET  /api/pets      — list the signed-in user's pet profiles (newest first)
// POST /api/pets      — create a new pet profile
//
// Called from the analyze upload flow's inline pet picker. Deliberately
// minimal — no PATCH/DELETE yet. Users can currently only add, not edit.
// If we need per-pet history filters or edits later we'll extend this.
//
// RLS on public.pet_profiles already enforces user_id = auth.uid() at
// the DB layer; the Supabase client here uses the user's JWT so RLS
// applies automatically to both reads and writes.
//
// Per-tier caps (from /pricing):
//   Free    — 1 pet profile
//   Premium — 5 pet profiles
//   Pro     — 15 pet profiles
// The cap is enforced HERE (server-side) because it's a tier promise,
// not a UI convenience. Client-side hiding of the "Add" button is a
// hint, not a guarantee.

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const MAX_NAME_LEN = 40;
const MAX_BREED_LEN = 60;
const MAX_AGE_LEN = 30;

const PET_LIMIT_BY_TIER: Record<string, number> = {
  free: 1,
  active_premium: 5,
  active_pro: 15,
  // Testers get the Pro cap so they can dogfood the whole thing
  tester: 15,
};

function resolveCap(profile: {
  subscription_status: string | null;
  subscription_tier: string | null;
  is_tester: boolean | null;
  tester_expires_at: string | null;
}): number {
  const now = new Date();
  const testerActive =
    !!profile.is_tester &&
    (!profile.tester_expires_at || new Date(profile.tester_expires_at) > now);
  if (testerActive) return PET_LIMIT_BY_TIER.tester;
  if (profile.subscription_status === "active") {
    if (profile.subscription_tier === "pro") return PET_LIMIT_BY_TIER.active_pro;
    if (profile.subscription_tier === "premium") return PET_LIMIT_BY_TIER.active_premium;
  }
  return PET_LIMIT_BY_TIER.free;
}

// TTL for the signed avatar-display URLs the list endpoint returns.
// Long enough that the page stays fresh through several navigations
// but short enough that the URL is not durable if it leaks.
const AVATAR_URL_TTL_SECS = 900; // 15 min

// -----------------------------------------------------------------------------
// GET — list pets
// -----------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("pet_profiles")
    .select("id, name, species, breed, approximate_age, photo_path, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("pets_list_failed", error.message);
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  // Mint fresh 15-min signed URLs for every pet that has a photo_path.
  // We batch-sign via createSignedUrls (one round-trip) to keep this
  // fast even when the user has 15 Pro-tier pets.
  const rows = data ?? [];
  const paths = rows
    .map((r) => r.photo_path)
    .filter((p): p is string => !!p);
  const photoUrlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const svc = createServiceClient();
    const { data: signed } = await svc
      .storage
      .from("videos")
      .createSignedUrls(paths, AVATAR_URL_TTL_SECS);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) photoUrlByPath.set(item.path, item.signedUrl);
    }
  }

  const pets = rows.map((r) => ({
    ...r,
    photo_url: r.photo_path ? photoUrlByPath.get(r.photo_path) ?? null : null,
  }));
  return NextResponse.json({ pets });
}

// -----------------------------------------------------------------------------
// POST — create a pet
// Body: { name: string, species: "dog"|"cat", breed?: string, approximate_age?: string }
// -----------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    name?: string;
    species?: string;
    breed?: string;
    approximate_age?: string;
    photo_path?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim().slice(0, MAX_NAME_LEN);
  const species = String(body.species ?? "").trim().toLowerCase();
  const breed = body.breed
    ? String(body.breed).trim().slice(0, MAX_BREED_LEN) || null
    : null;
  const age = body.approximate_age
    ? String(body.approximate_age).trim().slice(0, MAX_AGE_LEN) || null
    : null;
  // photo_path is minted by /api/pets/upload-avatar and must be under
  // the user's own auth.uid prefix. Reject foreign paths to prevent a
  // malicious client from linking someone else's file.
  const photoPath = body.photo_path
    ? (String(body.photo_path).trim().startsWith(`${user.id}/`)
        ? String(body.photo_path).trim()
        : null)
    : null;

  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (species !== "dog" && species !== "cat") {
    return NextResponse.json({ error: "invalid_species" }, { status: 400 });
  }
  if (body.photo_path && photoPath === null) {
    return NextResponse.json({ error: "invalid_photo_path" }, { status: 400 });
  }

  // Enforce the tier cap. Do the count via service client so RLS
  // doesn't need a policy for the count-check-then-insert pattern.
  const svc = createServiceClient();
  const [{ count }, { data: profile }] = await Promise.all([
    svc
      .from("pet_profiles")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id),
    svc
      .from("profiles")
      .select("subscription_status, subscription_tier, is_tester, tester_expires_at")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const cap = resolveCap(
    profile ?? {
      subscription_status: null,
      subscription_tier: null,
      is_tester: false,
      tester_expires_at: null,
    },
  );
  if ((count ?? 0) >= cap) {
    return NextResponse.json(
      {
        error: "pet_limit_reached",
        cap,
        message: `Your plan allows ${cap} pet profile${cap === 1 ? "" : "s"}. Upgrade to add more.`,
      },
      { status: 402 },
    );
  }

  // Insert via the user's JWT so RLS approves the write.
  const { data: pet, error: insErr } = await supabase
    .from("pet_profiles")
    .insert({
      user_id: user.id,
      name,
      species,
      breed,
      approximate_age: age,
      photo_path: photoPath,
    })
    .select("id, name, species, breed, approximate_age, photo_path, created_at")
    .single();

  if (insErr || !pet) {
    console.error("pets_create_failed", insErr?.message);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
  return NextResponse.json({ pet }, { status: 201 });
}

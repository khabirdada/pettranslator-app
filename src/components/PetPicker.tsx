"use client";

// PetPicker — inline pet-profile capture for the analyze upload flow.
//
// Design goals:
//   - Zero friction for users who don't care. The default state is
//     "None — analyze without saving". Selecting a pet is opt-in.
//   - Progressive disclosure. Existing pets show as chip strip
//     (round avatar + name + species). A compact "+ New pet" chip
//     expands into a mini form (name + species radio + optional
//     breed + optional age + optional avatar upload) that saves on
//     click without leaving the page.
//   - Editorial register — hairline borders, mono eyebrow, no rounded
//     modals, no emoji, no icon-heavy chrome. Chips + inline expand.
//   - Cap-aware: once the user hits their tier cap the "+ New pet"
//     chip shows the upgrade path instead of the form.
//
// Emits `onChange(petId)` with either a pet UUID or null. The parent
// (analyze/page.tsx) sends this as `petId` in the analyze POST body.

import { useEffect, useRef, useState } from "react";

type Species = "dog" | "cat";

export type PetProfile = {
  id: string;
  name: string;
  species: Species;
  breed: string | null;
  approximate_age: string | null;
  photo_path: string | null;
  photo_url: string | null; // 15-min signed URL minted by /api/pets
};

type LimitError = {
  error: "pet_limit_reached";
  cap: number;
  message: string;
};

type Props = {
  /** Called with the selected pet's UUID, or null for "None". */
  value: string | null;
  onChange: (petId: string | null) => void;
  /** Disable interaction while the parent is submitting. */
  disabled?: boolean;
};

// Fires the two-step avatar upload: (1) get a signed URL from our API,
// (2) PUT the file bytes to Supabase Storage. Returns the storage path
// to persist on the pet_profiles row. Errors bubble up so the caller
// can surface them without breaking the parent create flow.
async function uploadPetAvatar(file: File): Promise<string> {
  const signRes = await fetch("/api/pets/upload-avatar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mime: file.type, size: file.size }),
  });
  if (!signRes.ok) {
    const err = await signRes.json().catch(() => ({}));
    throw new Error(err.error ?? `sign_${signRes.status}`);
  }
  const { uploadUrl, storagePath } = (await signRes.json()) as {
    uploadUrl: string;
    storagePath: string;
  };
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error(`put_${putRes.status}`);
  return storagePath;
}

export function PetPicker({ value, onChange, disabled = false }: Props) {
  const [pets, setPets] = useState<PetProfile[] | null>(null); // null = loading
  const [showForm, setShowForm] = useState(false);
  const [limit, setLimit] = useState<LimitError | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [species, setSpecies] = useState<Species>("dog");
  const [breed, setBreed] = useState("");
  const [age, setAge] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/pets")
      .then((r) => r.json())
      .then((json) => {
        if (!active) return;
        setPets(Array.isArray(json.pets) ? json.pets : []);
      })
      .catch(() => {
        if (!active) return;
        setPets([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // Release blob preview when the form closes or the file changes.
  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(f);
    setAvatarPreview(f ? URL.createObjectURL(f) : null);
  }

  function resetForm() {
    setName("");
    setBreed("");
    setAge("");
    setSpecies("dog");
    setAvatarFile(null);
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(null);
    if (fileRef.current) fileRef.current.value = "";
    setError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give your pet a name.");
      return;
    }
    setSaving(true);
    setError(null);
    setLimit(null);
    try {
      // Upload avatar FIRST if selected — we want the pet_profiles row
      // to be created with photo_path already set so the chip shows
      // the avatar immediately without a second render cycle.
      let photoPath: string | undefined;
      if (avatarFile) {
        photoPath = await uploadPetAvatar(avatarFile);
      }

      const res = await fetch("/api/pets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          species,
          breed: breed.trim() || undefined,
          approximate_age: age.trim() || undefined,
          photo_path: photoPath,
        }),
      });
      const json = await res.json();
      if (res.status === 402 && json.error === "pet_limit_reached") {
        setLimit(json as LimitError);
        return;
      }
      if (!res.ok) {
        setError(json.error ?? `Couldn't save (${res.status})`);
        return;
      }
      const pet = json.pet as PetProfile;
      // The API's POST response doesn't include a photo_url (only GET
      // signs URLs). If we uploaded an avatar, use the local preview
      // URL until the next full refresh — it's the same file bytes,
      // just via blob URL. Cleaner than a follow-up GET roundtrip.
      const petWithUrl: PetProfile = { ...pet, photo_url: avatarPreview };
      setPets((prev) => (prev ? [petWithUrl, ...prev] : [petWithUrl]));
      onChange(pet.id);
      // Don't revoke avatarPreview yet — the new chip still uses it.
      setAvatarPreview(null); // clear so effect cleanup doesn't fire
      resetForm();
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
    } finally {
      setSaving(false);
    }
  }

  // Skeleton while loading
  if (pets === null) {
    return (
      <div className="mb-6">
        <p className="label mb-2">Whose photo is this? · optional</p>
        <div className="h-10 rounded-full border border-rule bg-paper-light animate-pulse" />
      </div>
    );
  }

  const hasPets = pets.length > 0;

  return (
    <div className="mb-6">
      <p className="label mb-2">Whose photo is this? · optional</p>

      {/* Chip strip — None + existing pets + "+ New pet" */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className={
            "text-sm px-3.5 py-1.5 rounded-full border transition-colors " +
            (value === null
              ? "border-ink bg-ink text-paper-light"
              : "border-rule bg-paper-light text-slate hover:border-ink/40")
          }
        >
          {hasPets ? "None" : "Skip"}
        </button>

        {pets.map((pet) => {
          const active = value === pet.id;
          return (
            <button
              key={pet.id}
              type="button"
              onClick={() => onChange(pet.id)}
              disabled={disabled}
              className={
                "text-sm pl-1 pr-3.5 py-1 rounded-full border transition-colors flex items-center gap-2 " +
                (active
                  ? "border-terra bg-terra text-paper-light"
                  : "border-rule bg-paper-light text-slate hover:border-terra/50")
              }
            >
              {/* Round avatar or initial — the visual anchor that makes
                  chips scannable when the user has many pets. */}
              {pet.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pet.photo_url}
                  alt=""
                  className="w-6 h-6 rounded-full object-cover border border-rule/50"
                />
              ) : (
                <span
                  className={
                    "w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-mono uppercase " +
                    (active
                      ? "border-paper-light/40 bg-paper-light/10 text-paper-light"
                      : "border-rule bg-paper text-slate-soft")
                  }
                >
                  {pet.name.charAt(0)}
                </span>
              )}
              <span>{pet.name}</span>
              <span
                className={
                  "font-mono text-[10px] uppercase tracking-[0.1em] " +
                  (active ? "text-paper-light/80" : "text-slate-soft")
                }
              >
                {pet.species}
              </span>
            </button>
          );
        })}

        {!showForm && !limit && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            disabled={disabled}
            className="text-sm px-3.5 py-1.5 rounded-full border border-dashed border-rule text-terra hover:border-terra/60 transition-colors"
          >
            + New pet
          </button>
        )}

        {/* Manage-pets link — appears once the user has at least one
            pet. Anchors to the dedicated /pets route for edit/delete. */}
        {hasPets && !showForm && (
          <a
            href="/pets"
            className="text-xs px-3 py-1.5 text-slate-soft hover:text-terra font-mono uppercase tracking-[0.12em]"
          >
            Manage →
          </a>
        )}
      </div>

      {/* Inline add form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mt-4 border border-rule rounded-2xl p-5 bg-paper-light"
        >
          <div className="grid sm:grid-cols-[auto_1fr] gap-5 items-start">
            {/* Avatar upload — round 72px, click to open file picker */}
            <div className="flex flex-col items-center">
              <label className="label mb-1.5">Photo · optional</label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={saving || disabled}
                className="w-[72px] h-[72px] rounded-full border border-dashed border-rule bg-paper hover:border-terra flex items-center justify-center overflow-hidden transition-colors"
                aria-label="Upload pet photo"
              >
                {avatarPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarPreview}
                    alt="Pet preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-soft">
                    + photo
                  </span>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={onAvatarChange}
                disabled={saving || disabled}
                className="hidden"
              />
            </div>

            {/* Name + species */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pet-name" className="label mb-1.5 block">
                  Name
                </label>
                <input
                  id="pet-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  autoFocus
                  disabled={saving || disabled}
                  placeholder="e.g. Buddy"
                  className="input"
                />
              </div>
              <div>
                <label className="label mb-1.5 block">Species</label>
                <div className="flex gap-2">
                  {(["dog", "cat"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSpecies(s)}
                      disabled={saving || disabled}
                      className={
                        "flex-1 text-sm px-4 py-2.5 rounded-full border transition-colors " +
                        (species === s
                          ? "border-ink bg-ink text-paper-light"
                          : "border-rule bg-paper text-slate hover:border-ink/40")
                      }
                    >
                      {s === "dog" ? "Dog" : "Cat"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Optional fields */}
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label htmlFor="pet-breed" className="label mb-1.5 block">
                Breed · optional
              </label>
              <input
                id="pet-breed"
                type="text"
                value={breed}
                onChange={(e) => setBreed(e.target.value)}
                maxLength={60}
                disabled={saving || disabled}
                placeholder="e.g. Border Collie mix"
                className="input"
              />
            </div>
            <div>
              <label htmlFor="pet-age" className="label mb-1.5 block">
                Approx. age · optional
              </label>
              <input
                id="pet-age"
                type="text"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                maxLength={30}
                disabled={saving || disabled}
                placeholder="e.g. 3 years"
                className="input"
              />
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-terra">{error}</p>}

          <div className="mt-5 flex flex-col sm:flex-row gap-3 items-start">
            <button
              type="submit"
              disabled={saving || disabled || !name.trim()}
              className="btn"
            >
              {saving ? "Saving…" : "Save pet →"}
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
              disabled={saving}
              className="btn btn-light"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {limit && (
        <div className="mt-4 border border-terra rounded-2xl p-4 bg-paper-light">
          <p className="label mb-1.5" style={{ color: "var(--terra)" }}>
            Pet-profile limit reached
          </p>
          <p className="text-sm text-ink leading-relaxed mb-3">{limit.message}</p>
          <a href="/pricing" className="btn">
            See plans →
          </a>
        </div>
      )}
    </div>
  );
}

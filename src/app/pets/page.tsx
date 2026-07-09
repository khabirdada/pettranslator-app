"use client";

// /pets — pet-profile management page.
//
// Card grid with per-pet edit + delete controls. Reuses the same
// endpoints as PetPicker: GET/POST/PATCH/DELETE on /api/pets and
// /api/pets/upload-avatar for photos.
//
// Design register: editorial, no cards-with-shadows. Hairline borders,
// round avatar, name in serif, meta in mono. Edit expands the card
// inline (never a modal). Delete requires a confirm click to guard
// against accidental history-nulling.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Species = "dog" | "cat";

type Pet = {
  id: string;
  name: string;
  species: Species;
  breed: string | null;
  approximate_age: string | null;
  photo_path: string | null;
  photo_url: string | null;
};

type LimitError = {
  error: "pet_limit_reached";
  cap: number;
  message: string;
};

async function uploadAvatar(file: File): Promise<string> {
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

export default function PetsPage() {
  const [pets, setPets] = useState<Pet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<LimitError | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  async function refresh() {
    const res = await fetch("/api/pets");
    if (!res.ok) {
      setError(`Failed to load (${res.status})`);
      setPets([]);
      return;
    }
    const json = await res.json();
    setPets(Array.isArray(json.pets) ? json.pets : []);
  }

  useEffect(() => {
    refresh();
  }, []);

  if (pets === null) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
        <p className="label mb-4">§ Pets</p>
        <h1 className="mb-6">
          Loading your <em className="text-terra">pets</em>…
        </h1>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
      <p className="label mb-4">§ Pets</p>
      <h1 className="mb-4">
        Your <em className="text-terra">pets</em>.
      </h1>
      <p className="text-slate max-w-prose mb-10">
        Each pet you save gets tagged onto its analyses. Deleting a pet
        won&rsquo;t erase past reports — those keep their content, they
        just lose the pet tag.
      </p>

      {error && (
        <div className="border border-terra/40 rounded-2xl p-4 bg-paper-light text-sm mb-6">
          {error}
        </div>
      )}

      {limit && (
        <div className="border border-terra rounded-2xl p-4 bg-paper-light mb-6">
          <p className="label mb-1.5" style={{ color: "var(--terra)" }}>
            Pet-profile limit reached
          </p>
          <p className="text-sm text-ink leading-relaxed mb-3">{limit.message}</p>
          <Link href="/pricing" className="btn">
            See plans →
          </Link>
        </div>
      )}

      {/* Empty state — first-run affordance */}
      {pets.length === 0 && !showAdd && (
        <div className="border border-rule rounded-2xl p-8 bg-paper-light text-center mb-6">
          <p className="font-serif text-2xl mb-3">
            No <em className="text-terra">pets</em> saved yet.
          </p>
          <p className="text-slate mb-6 max-w-md mx-auto">
            Save a pet profile to tag your analyses. It also helps the AI
            calibrate — species, breed, and approximate age all feed into
            the interpretation.
          </p>
          <button onClick={() => setShowAdd(true)} className="btn">
            Add your first pet →
          </button>
        </div>
      )}

      {/* Add form (top of list when open) */}
      {showAdd && (
        <PetForm
          initial={null}
          onSuccess={async () => {
            setShowAdd(false);
            await refresh();
          }}
          onCancel={() => setShowAdd(false)}
          onLimit={(l) => {
            setShowAdd(false);
            setLimit(l);
          }}
        />
      )}

      {/* Add button on non-empty list */}
      {pets.length > 0 && !showAdd && !limit && (
        <div className="mb-6">
          <button onClick={() => setShowAdd(true)} className="btn">
            + Add pet
          </button>
        </div>
      )}

      {/* Pet cards */}
      {pets.length > 0 && (
        <ul className="grid gap-4">
          {pets.map((pet) => (
            <li key={pet.id}>
              <PetCard pet={pet} onRefresh={refresh} />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 pt-6 border-t border-rule flex flex-col sm:flex-row gap-3">
        <Link href="/analyze" className="btn">
          New analysis →
        </Link>
        <Link href="/dashboard" className="btn btn-light">
          ← Back to dashboard
        </Link>
      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// PetCard — display + inline edit + delete-with-confirm
// -----------------------------------------------------------------------------
function PetCard({ pet, onRefresh }: { pet: Pet; onRefresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/pets/${pet.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDeleteError(err.error ?? `Delete failed (${res.status})`);
        return;
      }
      await onRefresh();
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (editing) {
    return (
      <PetForm
        initial={pet}
        onSuccess={async () => {
          setEditing(false);
          await onRefresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="border border-rule rounded-2xl p-5 bg-paper-light flex items-start gap-5">
      {/* Round avatar */}
      {pet.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={pet.photo_url}
          alt=""
          className="w-16 h-16 rounded-full object-cover border border-rule flex-shrink-0"
        />
      ) : (
        <div className="w-16 h-16 rounded-full border border-dashed border-rule bg-paper flex items-center justify-center flex-shrink-0">
          <span className="font-mono text-sm uppercase text-slate-soft">
            {pet.name.charAt(0)}
          </span>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="font-serif text-xl text-ink">{pet.name}</p>
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-slate-soft mt-0.5">
          {pet.species}
          {pet.breed ? ` · ${pet.breed}` : ""}
          {pet.approximate_age ? ` · ${pet.approximate_age}` : ""}
        </p>

        {deleteError && (
          <p className="mt-2 text-sm text-terra">{deleteError}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <Link
            href={`/dashboard?pet=${pet.id}`}
            className="text-xs px-3 py-1.5 rounded-full border border-rule text-slate hover:border-terra hover:text-terra transition-colors"
          >
            View {pet.name}&rsquo;s analyses
          </Link>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs px-3 py-1.5 rounded-full border border-rule text-slate hover:border-ink hover:text-ink transition-colors"
          >
            Edit
          </button>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-xs px-3 py-1.5 rounded-full border border-rule text-slate hover:border-terra hover:text-terra transition-colors"
            >
              Delete
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-xs text-slate-soft">Sure?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs px-3 py-1.5 rounded-full border border-terra text-terra hover:bg-terra hover:text-paper-light transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="text-xs px-3 py-1.5 rounded-full border border-rule text-slate hover:border-ink hover:text-ink transition-colors"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// PetForm — used for both add (initial=null) and edit (initial=pet).
// Kept as an internal component so state resets naturally when
// switching between add and edit modes.
// -----------------------------------------------------------------------------
function PetForm({
  initial,
  onSuccess,
  onCancel,
  onLimit,
}: {
  initial: Pet | null;
  onSuccess: () => void | Promise<void>;
  onCancel: () => void;
  onLimit?: (limit: LimitError) => void;
}) {
  const editing = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [species, setSpecies] = useState<Species>(initial?.species ?? "dog");
  const [breed, setBreed] = useState(initial?.breed ?? "");
  const [age, setAge] = useState(initial?.approximate_age ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    initial?.photo_url ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      // Only revoke blob-URLs we created — not the API-signed photo_url
      if (avatarPreview && avatarPreview.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (avatarPreview && avatarPreview.startsWith("blob:")) {
      URL.revokeObjectURL(avatarPreview);
    }
    setAvatarFile(f);
    setAvatarPreview(f ? URL.createObjectURL(f) : null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give your pet a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let photoPath: string | undefined;
      if (avatarFile) {
        photoPath = await uploadAvatar(avatarFile);
      }

      if (editing && initial) {
        const res = await fetch(`/api/pets/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            breed: breed.trim() || null,
            approximate_age: age.trim() || null,
            ...(photoPath !== undefined ? { photo_path: photoPath } : {}),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError(err.error ?? `Update failed (${res.status})`);
          return;
        }
      } else {
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
          onLimit?.(json);
          return;
        }
        if (!res.ok) {
          setError(json.error ?? `Save failed (${res.status})`);
          return;
        }
      }
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-rule rounded-2xl p-5 bg-paper-light mb-4"
    >
      <p className="label mb-4">{editing ? "Edit pet" : "New pet"}</p>

      <div className="grid sm:grid-cols-[auto_1fr] gap-5 items-start">
        <div className="flex flex-col items-center">
          <label className="label mb-1.5">Photo · optional</label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={saving}
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
            disabled={saving}
            className="hidden"
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="name" className="label mb-1.5 block">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoFocus={!editing}
              disabled={saving}
              placeholder="e.g. Buddy"
              className="input"
            />
          </div>
          <div>
            <label className="label mb-1.5 block">Species</label>
            {editing ? (
              // Species is immutable after creation — a dog doesn't
              // become a cat. Show read-only chip so the user isn't
              // confused about why they can't change it.
              <div className="input flex items-center text-slate">
                <span className="font-mono text-xs uppercase tracking-[0.12em]">
                  {species}
                </span>
              </div>
            ) : (
              <div className="flex gap-2">
                {(["dog", "cat"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpecies(s)}
                    disabled={saving}
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
            )}
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <div>
          <label htmlFor="breed" className="label mb-1.5 block">
            Breed · optional
          </label>
          <input
            id="breed"
            type="text"
            value={breed}
            onChange={(e) => setBreed(e.target.value)}
            maxLength={60}
            disabled={saving}
            placeholder="e.g. Border Collie mix"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="age" className="label mb-1.5 block">
            Approx. age · optional
          </label>
          <input
            id="age"
            type="text"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            maxLength={30}
            disabled={saving}
            placeholder="e.g. 3 years"
            className="input"
          />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-terra">{error}</p>}

      <div className="mt-5 flex flex-col sm:flex-row gap-3 items-start">
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="btn"
        >
          {saving ? "Saving…" : editing ? "Save changes →" : "Save pet →"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="btn btn-light"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

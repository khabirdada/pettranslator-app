"use client";

// PetPicker — inline pet-profile capture for the analyze upload flow.
//
// Design goals:
//   - Zero friction for users who don't care. The default state is
//     "None — analyze without saving", which is what everyone was
//     effectively doing before this component existed. Selecting a
//     pet is opt-in.
//   - Progressive disclosure. Existing pets show as chip strip. A
//     compact "+ New pet" chip expands into a mini form (name + species
//     radio + optional breed/age) that saves on click without leaving
//     the page.
//   - Editorial register — hairline borders, mono eyebrow, no rounded
//     modals, no emoji, no dropdown-with-icon. Chips + inline expand.
//   - Cap-aware: once the user hits their tier cap the "+ New pet"
//     chip shows the upgrade path instead of the form.
//
// Emits `onChange(petId)` with either a pet UUID or null. The parent
// (analyze/page.tsx) sends this as `petId` in the analyze POST body.

import { useEffect, useState } from "react";

type Species = "dog" | "cat";

export type PetProfile = {
  id: string;
  name: string;
  species: Species;
  breed: string | null;
  approximate_age: string | null;
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

export function PetPicker({ value, onChange, disabled = false }: Props) {
  const [pets, setPets] = useState<PetProfile[] | null>(null); // null = loading
  const [showForm, setShowForm] = useState(false);
  const [limit, setLimit] = useState<LimitError | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state (only used while showForm is true)
  const [name, setName] = useState("");
  const [species, setSpecies] = useState<Species>("dog");
  const [breed, setBreed] = useState("");
  const [age, setAge] = useState("");
  const [saving, setSaving] = useState(false);

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
        setPets([]); // Fail closed — just show the form, don't block analysis
      });
    return () => {
      active = false;
    };
  }, []);

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
      const res = await fetch("/api/pets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          species,
          breed: breed.trim() || undefined,
          approximate_age: age.trim() || undefined,
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
      // Prepend new pet + auto-select it (matches user intent — they
      // just typed the name of the pet they're about to analyze)
      setPets((prev) => (prev ? [pet, ...prev] : [pet]));
      onChange(pet.id);
      // Reset form for possible reuse
      setName("");
      setBreed("");
      setAge("");
      setSpecies("dog");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
    } finally {
      setSaving(false);
    }
  }

  // Skeleton while loading — one line, no shimmer, ~40px tall so the
  // form below doesn't jump when the list resolves.
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

      {/* Chip strip — None + existing pets + "+ New pet"
          Wrap-friendly, no horizontal scroll. */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* "None" chip is the default selected state */}
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
                "text-sm px-3.5 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 " +
                (active
                  ? "border-terra bg-terra text-paper-light"
                  : "border-rule bg-paper-light text-slate hover:border-terra/50")
              }
            >
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
      </div>

      {/* Inline add form — expands when user clicks + New pet */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mt-4 border border-rule rounded-2xl p-5 bg-paper-light"
        >
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

          {/* Optional fields — collapsed grid, no visual weight */}
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

          {error && (
            <p className="mt-3 text-sm text-terra">{error}</p>
          )}

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
                setShowForm(false);
                setError(null);
                setName("");
                setBreed("");
                setAge("");
              }}
              disabled={saving}
              className="btn btn-light"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Cap-reached state — replaces the "+ New pet" chip once the
          tier limit is hit. Points to upgrade rather than silently
          failing. */}
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

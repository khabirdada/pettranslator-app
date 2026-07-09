// Protected route — proxy.ts redirects unauthenticated requests to /login.
//
// Now filterable by pet via `?pet=<uuid>`. The filter is:
//   - A chip strip at the top ("All" + one chip per pet + "Add pet")
//   - Applied to BOTH the recent-observations list AND the trend stats
//   - Preserved in the URL so users can bookmark "Buddy's dashboard"
//     or share it (RLS still gates the underlying data)
import Link from "next/link";
import { createClient, createServiceClient } from "@/lib/supabase/server";

function categorize(state: string | undefined | null): "calm" | "alert" | "tense" | "other" {
  if (!state) return "other";
  const s = state.toLowerCase();
  if (/relaxed|affiliative|comfortable|settled/.test(s)) return "calm";
  if (/alert|orienting|play|curious|solicitation/.test(s)) return "alert";
  if (/anxiety|fear|distress|conflict|defensive|aggression|frustration|overstimulation|guarding|displacement|stereotypic|threshold|redirected/.test(s)) return "tense";
  return "other";
}

type PetOption = {
  id: string;
  name: string;
  species: string;
  photo_path: string | null;
  photo_url?: string | null;
};

const AVATAR_URL_TTL_SECS = 900;

export default async function DashboardPage({
  searchParams,
}: {
  // Next.js 16 async searchParams
  searchParams: Promise<{ pet?: string }>;
}) {
  const sp = await searchParams;
  const petFilter = sp.pet && typeof sp.pet === "string" ? sp.pet : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Load pet options (for the filter strip) and recent analyses in parallel.
  // The analyses query is optionally filtered by pet_id.
  let recentQuery = supabase
    .from("analyses")
    .select("id, status, result_json, created_at, pet_id")
    .order("created_at", { ascending: false })
    .limit(petFilter ? 25 : 10);
  if (petFilter) recentQuery = recentQuery.eq("pet_id", petFilter);

  const [{ data: recent }, { data: petsRaw }] = await Promise.all([
    recentQuery,
    supabase
      .from("pet_profiles")
      .select("id, name, species, photo_path")
      .order("created_at", { ascending: true }),
  ]);

  const pets: PetOption[] = petsRaw ?? [];

  // Mint short-lived signed URLs for the avatar chips. Same 15-min TTL
  // as /api/pets. Only sign paths that actually exist (avatar upload
  // is optional per pet).
  const avatarPaths = pets.map((p) => p.photo_path).filter((p): p is string => !!p);
  if (avatarPaths.length > 0) {
    const svc = createServiceClient();
    const { data: signed } = await svc
      .storage
      .from("videos")
      .createSignedUrls(avatarPaths, AVATAR_URL_TTL_SECS);
    const byPath = new Map<string, string>();
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) byPath.set(item.path, item.signedUrl);
    }
    for (const pet of pets) {
      if (pet.photo_path) pet.photo_url = byPath.get(pet.photo_path) ?? null;
    }
  }

  // Resolve the currently-selected pet's display info (used in the
  // active-filter badge above the observations list).
  const activePet = petFilter ? pets.find((p) => p.id === petFilter) ?? null : null;

  // Stats on the (possibly filtered) results.
  const completed = (recent ?? []).filter((row) => row.status === "complete");
  const stats = completed.reduce(
    (acc, row) => {
      const r = row.result_json as { result_type?: string; emotional_state?: string } | null;
      if (r?.result_type === "analysis") {
        acc[categorize(r.emotional_state)] += 1;
        acc.total += 1;
      }
      return acc;
    },
    { total: 0, calm: 0, alert: 0, tense: 0, other: 0 } as {
      total: number; calm: number; alert: number; tense: number; other: number;
    },
  );
  const hasStats = stats.total >= 3;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
      <p className="label mb-4">§ Dashboard</p>
      <h1 className="mb-6">
        {activePet ? (
          <>
            <em className="text-terra">{activePet.name}&rsquo;s</em> observations.
          </>
        ) : (
          <>
            Your <em className="text-terra">observations</em>.
          </>
        )}
      </h1>
      <p className="text-slate mb-10 max-w-prose">
        Signed in as <strong className="text-ink">{user?.email}</strong>.
        Each upload becomes another entry in your pet&apos;s behavioral journal.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-8">
        <Link href="/analyze" className="btn w-full sm:w-auto justify-center">
          New analysis →
        </Link>
        <Link href="/pets" className="btn btn-light w-full sm:w-auto justify-center">
          Manage pets
        </Link>
      </div>

      {/* Pet filter strip — appears only when the user has pets. "All"
          resets the filter; each pet chip navigates to /dashboard?pet=id.
          Server-driven navigation (plain <Link>), no client state. */}
      {pets.length > 0 && (
        <div className="mb-10">
          <p className="label mb-2.5">Filter by pet</p>
          <div className="flex flex-wrap gap-2 items-center">
            <Link
              href="/dashboard"
              className={
                "text-sm px-3.5 py-1.5 rounded-full border transition-colors " +
                (petFilter === null
                  ? "border-ink bg-ink text-paper-light"
                  : "border-rule bg-paper-light text-slate hover:border-ink/40")
              }
            >
              All
            </Link>
            {pets.map((pet) => {
              const active = petFilter === pet.id;
              return (
                <Link
                  key={pet.id}
                  href={`/dashboard?pet=${pet.id}`}
                  className={
                    "text-sm pl-1 pr-3.5 py-1 rounded-full border transition-colors inline-flex items-center gap-2 " +
                    (active
                      ? "border-terra bg-terra text-paper-light"
                      : "border-rule bg-paper-light text-slate hover:border-terra/50")
                  }
                >
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
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {hasStats && (
        <div className="mb-10 border-y border-rule py-5">
          <p className="label mb-3">
            {activePet ? `${activePet.name} · behavioral trends` : "Behavioral trends"}
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-mono">
            <span className="text-ink">
              <span className="text-terra">{stats.total}</span> {stats.total === 1 ? "observation" : "observations"}
            </span>
            {stats.calm > 0 && (
              <span className="text-slate">
                <span className="text-ink">{stats.calm}</span> calm
              </span>
            )}
            {stats.alert > 0 && (
              <span className="text-slate">
                <span className="text-ink">{stats.alert}</span> alert
              </span>
            )}
            {stats.tense > 0 && (
              <span className="text-slate">
                <span className="text-ink">{stats.tense}</span> tense
              </span>
            )}
            {stats.other > 0 && (
              <span className="text-slate">
                <span className="text-ink">{stats.other}</span> other
              </span>
            )}
          </div>
        </div>
      )}

      <p className="label mb-4">
        {activePet ? `${activePet.name}'s recent observations` : "Recent observations"}
      </p>
      {!recent || recent.length === 0 ? (
        <p className="text-sm text-slate font-mono">
          {activePet
            ? `— no observations tagged to ${activePet.name} yet.`
            : "— no observations yet. Open one above."}
        </p>
      ) : (
        <ul className="border-t border-rule">
          {recent.map((row) => {
            const r = row.result_json as { result_type?: string; emotional_state?: string } | null;
            const title =
              r?.result_type === "analysis"
                ? r.emotional_state
                : r?.result_type === "refusal"
                  ? "Couldn't confidently assess"
                  : row.status === "failed"
                    ? "Didn't finish"
                    : row.status;
            return (
              <li key={row.id} className="border-b border-rule">
                <Link
                  href={`/analysis/${row.id}`}
                  className="flex items-baseline justify-between py-4 hover:text-terra transition"
                >
                  <span className="font-serif text-lg">{title}</span>
                  <span className="label">
                    {new Date(row.created_at).toLocaleDateString()} · {row.status}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

// Protected route — proxy.ts redirects unauthenticated requests to /login.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * Bucket an emotional_state string into one of 4 broad categories
 * for the dashboard stats row. Conservative: anything ambiguous bucks
 * to "other" so we don't mis-summarize the user's pet.
 */
function categorize(state: string | undefined | null): "calm" | "alert" | "tense" | "other" {
  if (!state) return "other";
  const s = state.toLowerCase();
  if (/relaxed|affiliative|comfortable|settled/.test(s)) return "calm";
  if (/alert|orienting|play|curious|solicitation/.test(s)) return "alert";
  if (/anxiety|fear|distress|conflict|defensive|aggression|frustration|overstimulation|guarding|displacement|stereotypic|threshold|redirected/.test(s)) return "tense";
  return "other";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Recent analyses for this user
  const { data: recent } = await supabase
    .from("analyses")
    .select("id, status, result_json, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  // Stats — count completed analyses by state category.
  // Only counts status='complete' (not refusals/failures).
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

  // Show the trends row only once it has enough data to feel meaningful.
  // With 1-2 reports it reads underwhelming ("1 report · 1 alert") and
  // pulls visual weight away from the actual case list.
  const hasStats = stats.total >= 3;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
      <p className="label mb-4">§ Dashboard</p>
      <h1 className="mb-6">
        Your <em className="text-terra">observations</em>.
      </h1>
      <p className="text-slate mb-10 max-w-prose">
        Signed in as <strong className="text-ink">{user?.email}</strong>.
        Each upload becomes another entry in your pet&apos;s behavioral journal.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-12">
        <Link href="/analyze" className="btn w-full sm:w-auto justify-center">
          New analysis →
        </Link>
      </div>

      {/* BEHAVIORAL TRENDS — appears once the user has ≥3 completed reports.
          Sub-3 it reads as filler; ≥3 it starts to look like longitudinal insight. */}
      {hasStats && (
        <div className="mb-10 border-y border-rule py-5">
          <p className="label mb-3">Behavioral trends</p>
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

      <p className="label mb-4">Recent observations</p>
      {!recent || recent.length === 0 ? (
        <p className="text-sm text-slate font-mono">
          — no observations yet. Open one above.
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

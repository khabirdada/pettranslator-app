// Protected route — proxy.ts redirects unauthenticated requests to /login.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
      <p className="label mb-4">§ Dashboard</p>
      <h1 className="mb-6">
        Hello, <em className="text-terra">friend</em>.
      </h1>
      <p className="text-slate mb-10 max-w-prose">
        Signed in as <strong className="text-ink">{user?.email}</strong>. Upload an image of your pet and the AI will return a behavioral analysis grounded in veterinary science.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-12">
        <Link href="/analyze" className="btn w-full sm:w-auto justify-center">
          New analysis →
        </Link>
      </div>

      <p className="label mb-4">Recent analyses</p>
      {!recent || recent.length === 0 ? (
        <p className="text-sm text-slate font-mono">— no analyses yet. Start one above.</p>
      ) : (
        <ul className="border-t border-rule">
          {recent.map((row) => {
            const r = row.result_json as { result_type?: string; emotional_state?: string } | null;
            const title =
              r?.result_type === "analysis"
                ? r.emotional_state
                : r?.result_type === "refusal"
                  ? "Cannot analyze"
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

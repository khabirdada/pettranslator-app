// Protected route — proxy.ts redirects unauthenticated requests to /login.
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-2xl px-6 py-20 sm:py-32">
      <p className="label mb-4">§ Dashboard · scaffolding</p>
      <h1 className="mb-6">
        Hello, <em className="text-terra">friend</em>.
      </h1>
      <p className="text-slate mb-10">
        Signed in as <strong className="text-ink">{user?.email}</strong>. The
        analysis product is in active development — this is the protected-route
        scaffold.
      </p>

      <p className="label">Coming next</p>
      <ul className="mt-3 space-y-2 text-sm text-slate font-mono">
        <li>· Video upload + analysis pipeline</li>
        <li>· Pet profile management</li>
        <li>· Stripe Checkout / Customer Portal</li>
        <li>· Perks library</li>
      </ul>
    </main>
  );
}

// Pre-launch placeholder for the app.
// If the visitor is already authenticated (e.g. after clicking a magic link
// or signup confirmation), send them straight to /dashboard.
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-20 sm:py-32">
      <p className="label mb-4">§ The app · pre-launch</p>

      <h1 className="mb-6">
        Soon. <em className="text-terra">Very</em> soon.
      </h1>

      <p className="text-lg text-slate leading-relaxed max-w-prose">
        The PetTranslator analysis product is in active development. The waitlist
        on the marketing site is the way in.
      </p>

      <div className="mt-10 flex flex-col sm:flex-row gap-3">
        <a href="https://pettranslator.ai" className="btn w-full sm:w-auto justify-center">
          Join the waitlist →
        </a>
        <Link href="/login" className="btn btn-light w-full sm:w-auto justify-center">
          I already have access
        </Link>
      </div>

      <p className="label mt-16">Next milestones</p>
      <ul className="mt-3 space-y-2 text-sm text-slate font-mono">
        <li>· Auth (magic link + Google)</li>
        <li>· Video upload → analysis</li>
        <li>· Results page (editorial report)</li>
        <li>· Stripe Checkout + Customer Portal</li>
        <li>· Perks library</li>
      </ul>
    </main>
  );
}

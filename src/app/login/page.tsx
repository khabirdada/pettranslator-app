"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Outer export — Suspense wrapper is required because useSearchParams() must
// be inside a Suspense boundary during prerender (Next.js 15+ requirement).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string>("");
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (status === "sent") {
    return (
      <main className="mx-auto max-w-md px-6 py-20 sm:py-32 text-center">
        <h1 className="mb-4 text-4xl">
          Check your <em className="text-terra">email</em>.
        </h1>
        <p className="text-slate">
          We sent a magic link to <strong className="text-ink">{email}</strong>. Open it on this device to sign in.
        </p>
        <p className="label mt-10">Didn&apos;t arrive? Check spam, or try again in a moment.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-20 sm:py-32">
      <p className="label mb-4">§ Sign in</p>
      <h1 className="mb-3 text-4xl">
        Welcome <em className="text-terra">back</em>.
      </h1>
      <p className="text-slate mb-10">
        Enter your email. We&apos;ll send a one-click magic link. No password to remember.
      </p>

      <form onSubmit={sendMagicLink} className="space-y-4">
        <label className="block">
          <span className="label mb-2 block">Email address</span>
          <input
            type="email"
            required
            inputMode="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="input"
            disabled={status === "sending"}
          />
        </label>
        <button
          type="submit"
          className="btn w-full justify-center"
          disabled={status === "sending" || !email}
        >
          {status === "sending" ? "Sending…" : "Send magic link →"}
        </button>
      </form>

      {error && (
        <p className="mt-6 text-sm text-terra">{error}</p>
      )}

      <p className="label mt-12">
        Don&apos;t have access yet?{" "}
        <a href="https://pettranslator.ai" className="text-ink hover:text-terra underline-offset-2 underline">
          Join the waitlist
        </a>
      </p>
    </main>
  );
}

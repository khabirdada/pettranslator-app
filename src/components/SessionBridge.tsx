"use client";

/**
 * SessionBridge — handles the implicit-flow magic-link redirect.
 *
 * When Supabase returns tokens in the URL hash (#access_token=...&refresh_token=...)
 * — which happens when the OTP request was made without PKCE — the server can't
 * see them. This component runs on the client, parses the hash, hands the tokens
 * to the browser Supabase client which writes them to cookies, then hard-reloads
 * the page so the server picks up the new session and routes us to /dashboard.
 *
 * Mounted in root layout so it runs on every page load. No-op when no hash tokens.
 */

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export function SessionBridge() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || !hash.includes("access_token=")) return;

    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) return;

    (async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (error) {
        console.error("SessionBridge setSession failed", error.message);
        return;
      }
      // Strip the hash so cookies, not URL fragments, become the source of truth.
      const cleanUrl = window.location.pathname + window.location.search;
      window.history.replaceState({}, document.title, cleanUrl);
      // Hard-reload so the next render is server-side with the new session cookies.
      window.location.href = "/dashboard";
    })();
  }, []);

  return null;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Consumer accounts should remain convenient across ordinary return visits,
// while abandoned shared-device sessions should not stay open indefinitely.
export const INACTIVITY_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const WARNING_WINDOW_MS = 5 * 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000;
const LAST_ACTIVITY_KEY = "pettranslator:last-activity";

export function AuthSessionControls() {
  const [signedIn, setSignedIn] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const lastWriteRef = useRef(0);
  const signingOutRef = useRef(false);

  const signOut = useCallback(async (reason: "manual" | "inactive") => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    window.location.assign(`/login?reason=${reason}`);
  }, []);

  const recordActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
    lastWriteRef.current = now;
    localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    setShowWarning(false);
  }, []);

  useEffect(() => {
    const supabase = createClient();

    void supabase.auth.getSession().then(({ data }) => {
      const hasSession = !!data.session;
      setSignedIn(hasSession);
      if (hasSession && !localStorage.getItem(LAST_ACTIVITY_KEY)) recordActivity();
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      if (session && !localStorage.getItem(LAST_ACTIVITY_KEY)) recordActivity();
    });

    return () => authListener.subscription.unsubscribe();
  }, [recordActivity]);

  useEffect(() => {
    if (!signedIn) return;

    const checkIdleTime = () => {
      const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
      const lastActivity = Number.isFinite(stored) && stored > 0 ? stored : Date.now();
      const idleFor = Date.now() - lastActivity;

      if (idleFor >= INACTIVITY_TIMEOUT_MS) {
        void signOut("inactive");
        return;
      }
      setShowWarning(idleFor >= INACTIVITY_TIMEOUT_MS - WARNING_WINDOW_MS);
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "scroll",
      "touchstart",
    ];
    for (const event of activityEvents) {
      window.addEventListener(event, recordActivity, { passive: true });
    }
    window.addEventListener("focus", recordActivity);
    document.addEventListener("visibilitychange", checkIdleTime);
    window.addEventListener("storage", checkIdleTime);

    checkIdleTime();
    const interval = window.setInterval(checkIdleTime, 60 * 1000);

    return () => {
      window.clearInterval(interval);
      for (const event of activityEvents) window.removeEventListener(event, recordActivity);
      window.removeEventListener("focus", recordActivity);
      document.removeEventListener("visibilitychange", checkIdleTime);
      window.removeEventListener("storage", checkIdleTime);
    };
  }, [recordActivity, signOut, signedIn]);

  if (!signedIn) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => void signOut("manual")}
        className="fixed right-4 top-4 z-50 rounded-full border border-rule bg-paper-light/95 px-4 py-2 text-xs font-semibold text-slate shadow-sm backdrop-blur transition-colors hover:border-terra hover:text-terra"
      >
        Sign out
      </button>

      {showWarning && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl flex-col gap-3 rounded-2xl border border-rule bg-paper-light p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-slate">
            You&apos;ll be signed out soon because this session has been inactive.
          </p>
          <button type="button" className="btn shrink-0 justify-center" onClick={recordActivity}>
            Stay signed in
          </button>
        </div>
      )}
    </>
  );
}

// Next.js 16 — formerly `middleware.ts`. Renamed to `proxy.ts`.
// Runs on every navigation to refresh the Supabase session cookie and gate
// protected routes.
import { type NextRequest } from "next/server";
import { refreshSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return refreshSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     *   - static asset paths (_next/static, _next/image)
     *   - the favicon and our public assets
     *   - auth callback (Supabase needs to set cookies before our handler runs)
     */
    "/((?!_next/static|_next/image|favicon-32\\.png|icon-.*\\.png|apple-touch-icon\\.png|manifest\\.json|assets/).*)",
  ],
};

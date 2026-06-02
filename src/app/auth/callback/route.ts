// Magic-link callback handler. Supabase redirects here after the user clicks
// the email link. We exchange the code for a session, set cookies, then
// redirect to the original destination.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("auth_callback_failed", error.message);
  }

  // Failure — bounce back to login with an error flag the page can read
  return NextResponse.redirect(`${origin}/login?error=callback_failed`);
}

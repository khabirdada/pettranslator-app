import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const REFERRAL_COOKIE = "pettranslator_ref";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = rawCode.trim().toLowerCase();
  const destination = new URL("/pricing", req.url);

  if (!/^[a-z0-9_-]{3,32}$/.test(code)) {
    return NextResponse.redirect(destination);
  }

  const svc = createServiceClient();
  const { data: partner } = await svc
    .from("creator_partners")
    .select("id")
    .eq("code", code)
    .eq("status", "active")
    .maybeSingle();

  const response = NextResponse.redirect(destination);
  if (partner) {
    response.cookies.set(REFERRAL_COOKIE, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: THIRTY_DAYS,
      path: "/",
    });
  }
  return response;
}


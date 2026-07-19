// Resend send wrapper + stateless unsubscribe-token helpers.
//
// We keep unsubscribe tokens STATELESS by signing the user_id with
// HMAC-SHA256 keyed off EMAIL_UNSUBSCRIBE_SECRET. That gives us:
//   - No extra DB column for tokens
//   - Any user_id → deterministic, verifiable token
//   - Constant-time verification with no round-trip
// If the secret is ever rotated, all existing unsubscribe links
// invalidate cleanly — that's the intended failure mode.

import { Resend } from "resend";
import crypto from "node:crypto";

const FROM = "PetTranslator.ai <hello@pettranslator.ai>";
const REPLY_TO = "hello@pettranslator.ai";

let cachedClient: Resend | null = null;
function getResend(): Resend {
  if (!cachedClient) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not configured");
    cachedClient = new Resend(key);
  }
  return cachedClient;
}

export type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional tag for Resend analytics — used to group drip stages. */
  tag?: string;
};

export async function sendEmail(args: SendArgs): Promise<{ id: string }> {
  const client = getResend();
  const { data, error } = await client.emails.send({
    from: FROM,
    to: args.to,
    // Resend v6 uses camelCase (replyTo, not reply_to).
    replyTo: REPLY_TO,
    subject: args.subject,
    html: args.html,
    text: args.text,
    // Tags — pass "onboarding-1" through "onboarding-4" so we can
    // measure open rates by drip stage in the Resend dashboard.
    ...(args.tag ? { tags: [{ name: "drip", value: args.tag }] } : {}),
  });
  if (error) throw new Error(`resend_send_failed: ${error.message}`);
  return { id: data?.id ?? "unknown" };
}

// -----------------------------------------------------------------------------
// Unsubscribe token: `<userId>.<hmac>`
// URL-safe base64. HMAC keyed off EMAIL_UNSUBSCRIBE_SECRET.
// -----------------------------------------------------------------------------
function secret(): string {
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!s || s.length < 24) {
    throw new Error("EMAIL_UNSUBSCRIBE_SECRET not configured (need ≥24 chars)");
  }
  return s;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function makeUnsubscribeToken(userId: string): string {
  const uidPart = base64url(Buffer.from(userId, "utf8"));
  const mac = crypto.createHmac("sha256", secret()).update(userId).digest();
  return `${uidPart}.${base64url(mac)}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let userId: string;
  try {
    userId = fromBase64url(parts[0]).toString("utf8");
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", secret()).update(userId).digest();
  const provided = fromBase64url(parts[1]);
  if (expected.length !== provided.length) return null;
  // Constant-time compare — never leak "how close" the guess was.
  if (!crypto.timingSafeEqual(expected, provided)) return null;
  return userId;
}

export function unsubscribeUrl(userId: string): string {
  const token = makeUnsubscribeToken(userId);
  return `https://app.pettranslator.ai/unsubscribe/${encodeURIComponent(token)}`;
}

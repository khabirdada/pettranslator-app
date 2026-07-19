// Onboarding drip templates + a small render helper.
//
// Voice rules — every email in this file:
//   - Editorial-clinical, third-person about pets. No "your dog says…".
//   - One CTA per email. No secondary asks. No PS lines.
//   - No urgency ("hurry!", "act now!", "limited time!"). No exclamation
//     marks in subject lines. This is a behaviorist's clinic, not a
//     Groupon push.
//   - Every email footer includes a one-click unsubscribe link.
//   - Both HTML and plain-text versions provided — Resend sends both;
//     Gmail's clip-message-behavior is more forgiving when text is present.
//
// Design notes for the HTML:
//   - Table-based layout (email clients still on 2004 CSS).
//   - Inline styles only — no <style> blocks.
//   - Newsreader serif for headline, system-sans for body.
//   - Terracotta CTA button on paper background.
//   - Max width 560px; scales down cleanly on mobile.

const BRAND = {
  paper: "#F5F3E9",
  paperLight: "#FBFAF2",
  ink: "#1A1A1A",
  slate: "#606060",
  slateSoft: "#8A8A8A",
  terra: "#C46A45",
  rule: "#D8D2BF",
} as const;

const BASE = "https://app.pettranslator.ai";
const SITE = "https://pettranslator.ai";

type EmailPayload = {
  subject: string;
  html: string;
  text: string;
};

type EmailContext = {
  /** Fallback greeting when we don't know the user's name. */
  greetingName: string;
  /** Signed URL for a one-click unsubscribe. */
  unsubscribeUrl: string;
};

// ---- shared shell ----
// Every email inherits the same masthead + footer. Only the body block
// changes per drip stage. Keeps the visual system coherent across the
// 4-email arc.
function wrapHtml(bodyHtml: string, ctx: EmailContext): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PetTranslator.ai</title></head>
<body style="margin:0;padding:0;background:${BRAND.paper};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.ink};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.paper};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:${BRAND.paperLight};border:1px solid ${BRAND.rule};">
        <!-- Masthead -->
        <tr><td style="padding:28px 32px 20px 32px;border-bottom:1px solid ${BRAND.rule};">
          <div style="font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:22px;color:${BRAND.ink};letter-spacing:-0.01em;">
            PetTranslator<span style="color:${BRAND.terra};">.ai</span>
          </div>
          <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:${BRAND.slateSoft};margin-top:4px;">
            § Behavioral analysis · AI-powered
          </div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;line-height:1.55;font-size:15px;color:${BRAND.ink};">
          ${bodyHtml}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 32px;border-top:1px solid ${BRAND.rule};font-size:12px;color:${BRAND.slateSoft};line-height:1.5;">
          <div style="margin-bottom:10px;">
            You're receiving this because you signed up at
            <a href="${SITE}" style="color:${BRAND.terra};text-decoration:none;">pettranslator.ai</a>.
            Only 4 onboarding emails will ever come from this address.
          </div>
          <div>
            <a href="${ctx.unsubscribeUrl}" style="color:${BRAND.slateSoft};text-decoration:underline;">Unsubscribe</a>
            &nbsp;·&nbsp;
            <a href="mailto:hello@pettranslator.ai" style="color:${BRAND.slateSoft};text-decoration:underline;">hello@pettranslator.ai</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function primaryButton(label: string, href: string): string {
  return `<div style="margin:24px 0;">
    <a href="${href}" style="display:inline-block;background:${BRAND.terra};color:${BRAND.paperLight};font-weight:600;font-size:15px;text-decoration:none;padding:12px 28px;border-radius:999px;">
      ${label}
    </a>
  </div>`;
}

function headline(text: string, emphasis?: string): string {
  const emHtml = emphasis
    ? `<em style="font-style:italic;color:${BRAND.terra};">${emphasis}</em>`
    : "";
  return `<h1 style="font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:26px;line-height:1.2;letter-spacing:-0.02em;color:${BRAND.ink};margin:0 0 20px 0;">
    ${text} ${emHtml}
  </h1>`;
}

// ============================================================================
// EMAIL 1 — Welcome (fires instantly on first sign-in)
// Intent: get them to complete their first analysis TODAY.
// ============================================================================
export function welcomeEmail(ctx: EmailContext): EmailPayload {
  const body = `
    ${headline("Welcome to", "PetTranslator.ai.")}
    <p style="margin:0 0 16px 0;">
      We're glad you're here. Whatever brought you to us — a whale-eye
      you couldn't read, a tucked tail that keeps happening, a cat that
      does <em style="font-style:italic;">that weird thing</em> — the
      point of this tool is to give you the same behavioral read a
      certified behaviorist would give from a photo.
    </p>
    <p style="margin:0 0 20px 0;">
      Your free tier includes three full analyses, lifetime. Same AI
      model as our paid plans, no watermark on the report, no locked
      sections. Start with the pet you're most curious about.
    </p>
    ${primaryButton("Run your first analysis →", `${BASE}/analyze`)}
    <p style="margin:0 0 8px 0;color:${BRAND.slate};font-size:14px;">
      One tip before you upload — the AI reads best when eyes, ears, and
      full body are visible in natural light. Blurry or heavily backlit
      photos come back with lower confidence scores.
    </p>
  `;
  const text = `Welcome to PetTranslator.ai.

We're glad you're here. Whatever brought you to us — a whale-eye you couldn't read, a tucked tail that keeps happening, a cat that does *that weird thing* — the point of this tool is to give you the same behavioral read a certified behaviorist would give from a photo.

Your free tier includes three full analyses, lifetime. Same AI model as our paid plans, no watermark on the report, no locked sections.

Run your first analysis: ${BASE}/analyze

One tip: the AI reads best when eyes, ears, and full body are visible in natural light. Blurry or heavily backlit photos come back with lower confidence scores.

—
Unsubscribe: ${ctx.unsubscribeUrl}
`;
  return {
    subject: "Welcome to PetTranslator.ai · one photo, one report",
    html: wrapHtml(body, ctx),
    text,
  };
}

// ============================================================================
// EMAIL 2 — Day 3: The three most-missed body-language signals
// Intent: educational value + soft product nudge. Doesn't sell anything.
// ============================================================================
export function daythreeEmail(ctx: EmailContext): EmailPayload {
  const body = `
    ${headline("The three most-", "missed signals.")}
    <p style="margin:0 0 16px 0;">
      In our first year of pilot analyses, three body-language signals
      showed up over and over as the ones owners misread most:
    </p>
    <ol style="margin:0 0 20px 0;padding-left:20px;line-height:1.75;">
      <li><strong>Whale eye.</strong> Sclera visible at the medial
      corner of the eye. Usually read as "cute" — it's actually low-
      grade vigilance the dog wants relieved.</li>
      <li><strong>Slow tail wag at spine height.</strong> Not friendly.
      Not universally — a wag is arousal, not affect. Height, speed,
      and tension of the base carry the read.</li>
      <li><strong>Cat sitting with back turned.</strong> Often
      interpreted as ignoring. In secure cats, it's trust — they've
      picked you as the direction they don't need to monitor.</li>
    </ol>
    <p style="margin:0 0 20px 0;">
      Any of these familiar? Upload a photo and see what the AI reads
      — the observed markers are shown before the interpretation so
      you can double-check the logic.
    </p>
    ${primaryButton("Analyze a photo →", `${BASE}/analyze`)}
  `;
  const text = `The three most-missed signals.

In our first year of pilot analyses, three body-language signals showed up over and over as the ones owners misread most:

1. WHALE EYE. Sclera visible at the medial corner of the eye. Usually read as "cute" — it's actually low-grade vigilance the dog wants relieved.

2. SLOW TAIL WAG AT SPINE HEIGHT. Not friendly. A wag is arousal, not affect. Height, speed, and tension of the base carry the read.

3. CAT SITTING WITH BACK TURNED. Often interpreted as ignoring. In secure cats, it's trust — they've picked you as the direction they don't need to monitor.

Any of these familiar? Upload a photo and see what the AI reads — the observed markers are shown before the interpretation so you can double-check the logic.

Analyze a photo: ${BASE}/analyze

—
Unsubscribe: ${ctx.unsubscribeUrl}
`;
  return {
    subject: "The three most-missed body-language signals",
    html: wrapHtml(body, ctx),
    text,
  };
}

// ============================================================================
// EMAIL 3 — Day 7: Ready for the second read
// Intent: nudge the second analysis. Free tier caps at 3 lifetime.
// ============================================================================
export function daySevenEmail(ctx: EmailContext): EmailPayload {
  const body = `
    ${headline("Ready for", "the second read?")}
    <p style="margin:0 0 16px 0;">
      A single analysis is a snapshot. Two or three, over different
      contexts, is where the pattern starts to appear — is the whale
      eye happening near strangers, or near food, or near a specific
      dog on the same walk?
    </p>
    <p style="margin:0 0 20px 0;">
      Your free tier has two more analyses left. If your pet gives you
      the same look twice in the next week, that's the moment to
      upload the second frame.
    </p>
    ${primaryButton("Upload the next one →", `${BASE}/analyze`)}
    <p style="margin:0;color:${BRAND.slate};font-size:14px;">
      A behavioral pattern is more useful than a single interpretation.
      This is why real behaviorists ask for multiple video clips before
      writing a report — you're doing the same thing, one frame at a
      time.
    </p>
  `;
  const text = `Ready for the second read?

A single analysis is a snapshot. Two or three, over different contexts, is where the pattern starts to appear — is the whale eye happening near strangers, or near food, or near a specific dog on the same walk?

Your free tier has two more analyses left. If your pet gives you the same look twice in the next week, that's the moment to upload the second frame.

Upload the next one: ${BASE}/analyze

A behavioral pattern is more useful than a single interpretation. This is why real behaviorists ask for multiple video clips before writing a report — you're doing the same thing, one frame at a time.

—
Unsubscribe: ${ctx.unsubscribeUrl}
`;
  return {
    subject: "Ready for your pet's second read?",
    html: wrapHtml(body, ctx),
    text,
  };
}

// ============================================================================
// EMAIL 4 — Day 14: Behavioral journal (Premium nudge)
// Intent: final email in the sequence. Frames Premium as "a journal,"
// not "an upgrade." Ends the drip regardless of whether they convert.
// ============================================================================
export function dayFourteenEmail(ctx: EmailContext): EmailPayload {
  const body = `
    ${headline("A behavioral", "journal, for your pet.")}
    <p style="margin:0 0 16px 0;">
      This is the last email in your onboarding sequence — regardless
      of what you decide, we'll go quiet after this.
    </p>
    <p style="margin:0 0 16px 0;">
      Two weeks in, most owners who stay past the free tier stay for
      one reason: they've started using PetTranslator as a
      <em style="font-style:italic;color:${BRAND.terra};">behavioral
      journal</em>. Upload a photo whenever your pet does something
      you're not sure about — a month later you can scroll back through
      the history and see which behaviors trended up, which trended
      down, and what changed in the environment when they did.
    </p>
    <p style="margin:0 0 20px 0;">
      Premium ($4.99/mo or $39.99/yr) unlocks 30 analyses per month
      and the vet-ready PDF export. Pro ($9.99/mo or $79.99/yr) adds
      up to 15 pet profiles and priority queue. Free tier stays free
      forever if that's all you need.
    </p>
    ${primaryButton("See the three plans →", `${SITE}/pricing`)}
    <p style="margin:0;color:${BRAND.slate};font-size:14px;">
      Thanks for trying it. Reply to this email with the biggest
      question you still have about your pet's behavior — I read
      every reply personally.
    </p>
    <p style="margin:16px 0 0 0;color:${BRAND.slate};font-size:14px;">— Khabir, founder</p>
  `;
  const text = `A behavioral journal, for your pet.

This is the last email in your onboarding sequence — regardless of what you decide, we'll go quiet after this.

Two weeks in, most owners who stay past the free tier stay for one reason: they've started using PetTranslator as a behavioral journal. Upload a photo whenever your pet does something you're not sure about — a month later you can scroll back through the history and see which behaviors trended up, which trended down, and what changed in the environment when they did.

Premium ($4.99/mo or $39.99/yr) unlocks 30 analyses per month and the vet-ready PDF export. Pro ($9.99/mo or $79.99/yr) adds up to 15 pet profiles and priority queue. Free tier stays free forever if that's all you need.

See the three plans: ${SITE}/pricing

Thanks for trying it. Reply to this email with the biggest question you still have about your pet's behavior — I read every reply personally.

— Khabir, founder

—
Unsubscribe: ${ctx.unsubscribeUrl}
`;
  return {
    subject: "A behavioral journal, for your pet",
    html: wrapHtml(body, ctx),
    text,
  };
}

// Registry — cron picks the right template by stage. Stage 1 = welcome sent
// (i.e. the NEXT one to send is index 2, day-3). Function signature is
// (nextStageToSend) → email builder or null if nothing due.
export function emailForStage(nextStage: 1 | 2 | 3 | 4): (ctx: EmailContext) => EmailPayload {
  switch (nextStage) {
    case 1: return welcomeEmail;
    case 2: return daythreeEmail;
    case 3: return daySevenEmail;
    case 4: return dayFourteenEmail;
  }
}

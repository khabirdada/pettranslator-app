# PetTranslator Creator Program

## Pilot offer

- Approved creators receive complimentary Creator Pro for 90 days with no
  posting obligation.
- Creator Pro includes the same usage and feature limits as the public Pro
  plan: 75 analyses per month, 15 pet profiles, priority processing, trends,
  and PDF exports.
- Access may be extended after useful product feedback or an authentic
  collaboration. Extensions never require a positive review.
- Audience passes are issued as one memorable code per creator with a fixed
  redemption limit. Do not describe an automatically renewing Stripe discount
  as a free pass.

## Affiliate terms

- 20% commission on collected subscription revenue for 12 months.
- 30-day attribution window; an entered creator code overrides link
  attribution.
- Quarterly payouts with a $50 minimum.
- Refunds, disputes, taxes, and self-referrals are excluded.
- Gifted access and affiliate relationships must be clearly disclosed.
- Permission to reuse creator content is negotiated separately and in writing.

## Outreach guardrails

- Use personalized platform DMs first. Continue by email after a response or
  where the creator publicly invites business email.
- One follow-up after five business days; no further message after silence.
- Do not imply that PetTranslator replaces a veterinarian or credentialed
  behavior professional.
- Do not promise founder-provided behavioral expertise.
- Do not contact creators who promote dominance theory or aversive training.

## Referral links

Create an active row in `creator_partners`, then share:

`https://app.pettranslator.ai/r/<code>`

The route validates the code, stores a first-party 30-day attribution cookie,
and redirects to pricing. Checkout and subscription webhooks record the
referral in `creator_referrals`.

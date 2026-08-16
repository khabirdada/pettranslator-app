-- Creator-partner attribution. Codes are stored lowercase and are safe to
-- expose publicly; commission and payout calculations remain server-side.

create table if not exists public.creator_partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  code text not null unique check (code = lower(code) and code ~ '^[a-z0-9_-]{3,32}$'),
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  commission_bps integer not null default 2000 check (commission_bps between 0 and 5000),
  commission_months integer not null default 12 check (commission_months between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creator_referrals (
  id uuid primary key default gen_random_uuid(),
  creator_partner_id uuid not null references public.creator_partners(id),
  referred_user_id uuid not null references public.profiles(id) on delete cascade,
  stripe_checkout_session_id text unique,
  stripe_subscription_id text,
  status text not null default 'checkout_started'
    check (status in ('checkout_started', 'active', 'canceled', 'refunded')),
  attributed_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (creator_partner_id, referred_user_id)
);

alter table public.creator_partners enable row level security;
alter table public.creator_referrals enable row level security;

-- No client policies: creator and referral data are managed by service-role
-- routes until a dedicated creator dashboard is introduced.

create index if not exists creator_referrals_partner_status_idx
  on public.creator_referrals (creator_partner_id, status, attributed_at desc);

comment on table public.creator_partners is
  'Approved creator partners. Default commercial terms: 20% for 12 months.';
comment on table public.creator_referrals is
  'Server-side creator attribution from checkout through paid subscription.';


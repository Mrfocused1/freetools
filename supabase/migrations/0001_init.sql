-- =========================================================================
-- Quick Fix — initial schema
-- =========================================================================

-- Tier enum
create type public.tier as enum ('free', 'pro', 'business');

-- Job status enum
create type public.job_status as enum ('queued', 'processing', 'succeeded', 'failed');

-- ==========================
-- profiles — one row per auth.user
-- ==========================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  tier public.tier not null default 'free',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_current_period_end timestamptz,
  credit_balance integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_stripe_customer_idx on public.profiles(stripe_customer_id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ==========================
-- jobs — one row per background-removal request
-- ==========================
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  -- For anonymous free-tier users:
  anon_fingerprint text,
  anon_ip inet,
  status public.job_status not null default 'queued',
  tier public.tier not null default 'free',
  tool text not null default 'bg-remove',
  input_path text not null,          -- Supabase storage key
  output_path text,                  -- Supabase storage key (when succeeded)
  input_bytes bigint,
  input_width integer,
  input_height integer,
  model text,                        -- birefnet | birefnet-2k | birefnet+vitmatte
  worker_id text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index jobs_user_id_created_idx on public.jobs(user_id, created_at desc);
create index jobs_anon_fingerprint_idx on public.jobs(anon_fingerprint, created_at desc);
create index jobs_status_idx on public.jobs(status) where status in ('queued', 'processing');

-- ==========================
-- usage_events — append-only counter for quota enforcement
-- ==========================
create table public.usage_events (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  anon_fingerprint text,
  anon_ip inet,
  event_type text not null check (event_type in ('job_succeeded', 'credit_purchase', 'credit_spend')),
  credits_delta integer not null default 0,
  job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz not null default now()
);

create index usage_events_user_month_idx on public.usage_events(user_id, created_at desc);
create index usage_events_anon_month_idx on public.usage_events(anon_fingerprint, created_at desc);

-- ==========================
-- stripe_events — dedupe webhook deliveries
-- ==========================
create table public.stripe_events (
  id text primary key,           -- Stripe event id
  type text not null,
  created_at timestamptz not null default now()
);

-- ==========================
-- Row Level Security
-- ==========================
alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.usage_events enable row level security;

-- Users can read their own profile
create policy "Profiles: self read"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can update only non-sensitive fields of their own profile (we won't use this — server-only updates via service role)
-- Stripe/tier fields must stay server-only.

-- Jobs: users see only their own
create policy "Jobs: self read"
  on public.jobs for select
  using (auth.uid() = user_id);

-- Usage: users see only their own
create policy "Usage: self read"
  on public.usage_events for select
  using (auth.uid() = user_id);

-- Service role bypasses RLS automatically; all writes go through the Next.js server using SUPABASE_SERVICE_ROLE_KEY.

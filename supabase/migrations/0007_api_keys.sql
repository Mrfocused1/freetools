-- =========================================================================
-- API keys for the public HTTP API (Pro and Business tiers)
-- =========================================================================
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  key_hash text not null unique,     -- SHA-256 hex digest of the raw key
  key_prefix text not null,          -- first 12 chars for display
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_keys_user_idx on public.api_keys(user_id);

alter table public.api_keys enable row level security;

create policy "API keys: self read"
  on public.api_keys for select
  using (auth.uid() = user_id);

-- Writes only via service role.

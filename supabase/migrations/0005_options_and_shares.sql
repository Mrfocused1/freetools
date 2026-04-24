-- =========================================================================
-- Per-job processing options (feather, auto-crop, notify email)
-- =========================================================================
alter table public.jobs
  add column if not exists options jsonb not null default '{}'::jsonb;

-- =========================================================================
-- Shareable result permalinks
-- =========================================================================
create table if not exists public.shares (
  slug text primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  views integer not null default 0
);

create index if not exists shares_job_idx on public.shares(job_id);

-- When a share is created, copy the output image to a long-lived location
-- so the 1-hour cleanup doesn't delete it.
-- We keep shared images in a separate prefix: shared/<slug>.png
-- No policy changes needed — shares are served via service-role signed URLs
-- from the same Next.js server that renders the /s/[slug] page.

alter table public.shares enable row level security;

-- Read is open (shares are public-by-definition once created).
create policy "Shares: public read"
  on public.shares for select
  using (true);

-- Writes only via service role (the API route).

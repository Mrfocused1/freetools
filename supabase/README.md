# Supabase setup

## 1. Create a project
- Go to https://supabase.com → create project
- Copy the **Project URL**, **anon key**, and **service_role key** into `apps/web/.env.local`

## 2. Run migrations
In the Supabase SQL editor, run in order:
1. `migrations/0001_init.sql`
2. Create a Storage bucket via the UI: **Storage → New bucket** → name: `images`, private, 20 MB file size limit, allowed MIME types: `image/jpeg, image/png, image/webp`
3. `migrations/0002_storage.sql`

## 3. Enable pg_cron for 1h image retention
```sql
create extension if not exists pg_cron;
select cron.schedule(
  'cleanup-images',
  '*/10 * * * *',
  $$ delete from storage.objects where bucket_id = 'images' and created_at < now() - interval '1 hour' $$
);
```

## 4. Auth providers
- **Email magic link** is enabled by default — no extra config.
- Google OAuth (optional): Authentication → Providers → Google → follow Supabase's guide.

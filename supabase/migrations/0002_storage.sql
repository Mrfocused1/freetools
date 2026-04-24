-- =========================================================================
-- Storage buckets + retention
-- =========================================================================

-- Run this in the Supabase SQL editor AFTER creating the bucket `images` in the Storage UI,
-- or execute the bucket-creation RPC first (see comment below).

-- Optional programmatic bucket creation (requires supabase_admin):
-- insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- values ('images', 'images', false, 20971520, array['image/jpeg','image/png','image/webp']);

-- RLS on storage.objects
-- Input uploads: authenticated users upload to their own folder; anonymous users upload via service-role-signed URLs (no direct policy needed).
create policy "Users upload to their own input folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'images'
    and (storage.foldername(name))[1] = 'input'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Users can read their own input/output images
create policy "Users read their own images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'images'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or (storage.foldername(name))[1] = 'public-previews'
    )
  );

-- 1-hour retention: delete objects older than 1 hour.
-- Schedule via pg_cron (runs every 10 min):
--
-- create extension if not exists pg_cron;
-- select cron.schedule(
--   'cleanup-images',
--   '*/10 * * * *',
--   $$ delete from storage.objects where bucket_id = 'images' and created_at < now() - interval '1 hour' $$
-- );

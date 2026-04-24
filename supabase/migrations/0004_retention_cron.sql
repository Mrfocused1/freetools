-- 1-hour retention for images bucket via pg_cron.
-- Runs every 10 minutes. Deletes both storage.objects rows AND the underlying files
-- (Supabase cleans the files based on the metadata row).

create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-images',
  '*/10 * * * *',
  $$ delete from storage.objects
      where bucket_id = 'images'
        and created_at < now() - interval '1 hour' $$
);

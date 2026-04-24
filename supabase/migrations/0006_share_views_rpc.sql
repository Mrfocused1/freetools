-- Atomic view increment for /s/[slug] page hits.
create or replace function public.increment_share_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shares
     set views = views + 1
   where slug = p_slug;
end;
$$;

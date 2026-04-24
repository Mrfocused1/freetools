-- Atomic credit increment used by the Stripe webhook.
create or replace function public.increment_credits(p_user_id uuid, p_delta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set credit_balance = credit_balance + p_delta,
         updated_at = now()
   where id = p_user_id;
end;
$$;

-- Atomic credit spend — returns true if a credit was consumed.
create or replace function public.consume_credit(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_affected integer;
begin
  update public.profiles
     set credit_balance = credit_balance - 1,
         updated_at = now()
   where id = p_user_id
     and credit_balance > 0;
  get diagnostics rows_affected = row_count;
  return rows_affected > 0;
end;
$$;

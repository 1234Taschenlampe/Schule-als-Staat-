-- Required BEFORE disabling Supabase Auth email confirmation.
-- With confirmation disabled Supabase may implicitly mark any new email as confirmed.
-- A verified-email string must NEVER be sufficient for admin elevation.
-- Existing admins retain their role; new admins are granted only after independent identity verification.
create or replace function public.claim_initial_admin()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists(
    select 1 from public.profiles p
    where p.id=(select auth.uid()) and p.role='admin'
  );
$$;
revoke all on function public.claim_initial_admin() from public, anon, authenticated;
grant execute on function public.claim_initial_admin() to authenticated;

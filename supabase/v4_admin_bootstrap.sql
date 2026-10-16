-- Historic admin bootstrap function is intentionally non-privileged.
-- EMAIL-ONLY role elevation is unsafe once Supabase Confirm Email is disabled:
-- GoTrue can automatically mark new signups' email_confirmed_at as non-null.
-- Administrators are assigned ONLY after independent verification by a trusted operator.
create or replace function public.claim_initial_admin()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id=(select auth.uid()) and p.role='admin'
  );
$$;
revoke all on function public.claim_initial_admin() from public, anon, authenticated;
grant execute on function public.claim_initial_admin() to authenticated;

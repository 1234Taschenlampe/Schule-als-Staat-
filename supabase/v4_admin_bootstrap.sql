-- School-state V4: admin role bootstrap AFTER verified ownership of one of two explicitly authorized email addresses.
-- A string typed into a web form is NEVER proof of email ownership.
create or replace function public.claim_initial_admin()
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if not exists (
    select 1 from auth.users u
      where u.id = v_uid
        and lower(btrim(u.email)) in ('jan.felix.eckert@gmail.com', 'jan.felix.eckert@gmx.de')
        and u.email_confirmed_at is not null
  ) then
    return false;
  end if;
  update public.profiles set role='admin'
    where id=v_uid and role <> 'admin';
  return exists (
    select 1 from public.profiles where id=v_uid and role='admin'
  );
end;
$$;

revoke all on function public.claim_initial_admin() from public, anon, authenticated;
grant execute on function public.claim_initial_admin() to authenticated;

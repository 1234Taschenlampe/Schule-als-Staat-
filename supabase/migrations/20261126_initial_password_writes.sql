-- Apply the first-login restriction at the data boundary, including writes
-- inside privileged RPCs. The password change itself is handled by Supabase Auth.
create or replace function sas_private.require_rotated_password()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if exists(select from auth.users where id=(select auth.uid())
   and raw_app_meta_data->>'sas_initial_password'='true') then
  raise exception 'Bitte ändere zuerst dein einmaliges Startpasswort.' using errcode='42501';
 end if;
 return null;
end $$;
revoke all on function sas_private.require_rotated_password() from public,anon,authenticated;
do $$
declare item record;
begin
 for item in select c.oid::regclass as relation from pg_class c
   where c.relnamespace in ('public'::regnamespace,'sas_private'::regnamespace)
   -- The existing first-login form records legal consent before updating the password.
   and c.oid <> 'sas_private.school_legal_acknowledgements'::regclass
   and c.relkind in ('r','p') and not exists(select from pg_depend dep
    where dep.classid='pg_class'::regclass and dep.objid=c.oid and dep.deptype='e')
 loop
  execute format('create or replace trigger sas_initial_password_guard before insert or update or delete on %s
    for each statement execute function sas_private.require_rotated_password()',item.relation);
 end loop;
end $$;

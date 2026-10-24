-- Close public registration while preserving every existing account and admin.
-- Only a Supabase Admin API creation with trusted app_metadata passes this guard.
-- User-controlled user_metadata is NEVER a provisioning credential.
create or replace function public.sas_roster_registration_guard()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if coalesce(new.raw_app_meta_data->>'sas_roster_provisioned','') <> 'true'
    then raise exception 'Neue Konten werden ausschließlich über die offizielle Schülerliste angelegt.';
 end if;
 return new;
end;
$$;
revoke all on function public.sas_roster_registration_guard() from public,anon,authenticated;
drop trigger if exists sas_roster_registration_guard on auth.users;
create trigger sas_roster_registration_guard before insert on auth.users
for each row execute function public.sas_roster_registration_guard();

-- The seven-digit start PIN is temporary: its marker clears only when the
-- hashed auth password actually changes. No password or PIN is saved in public.
create or replace function public.sas_roster_password_changed()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if old.encrypted_password is distinct from new.encrypted_password
    and coalesce(old.raw_app_meta_data->>'sas_initial_password','')='true' then
   new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)-'sas_initial_password';
 end if;
 return new;
end;
$$;
revoke all on function public.sas_roster_password_changed() from public,anon,authenticated;
drop trigger if exists sas_roster_password_changed on auth.users;
create trigger sas_roster_password_changed before update of encrypted_password on auth.users
for each row execute function public.sas_roster_password_changed();

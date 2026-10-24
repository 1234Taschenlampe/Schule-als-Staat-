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

-- Internal identity register: server-only; not visible via anonymous API.
create table if not exists public.school_roster_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  login_id text not null unique check(login_id ~ '^SAS-[A-Z2-9]{10}$'),
  given_name text not null check(length(given_name) between 1 and 80),
  family_name text not null check(length(family_name) between 1 and 80),
  class_label text not null check(length(class_label) between 1 and 24),
  imported_at timestamptz not null default now(),
  active boolean not null default true
);
alter table public.school_roster_members enable row level security;
revoke all on public.school_roster_members from public,anon,authenticated;
grant select,insert,update on public.school_roster_members to service_role;
-- Table stays private despite residing in PostgREST's exposed public schema.

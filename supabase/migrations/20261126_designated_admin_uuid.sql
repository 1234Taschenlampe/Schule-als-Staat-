-- The schema owner provisions the single approved identity out of band.
-- Existing installations retain the current admin; fresh installations fail closed.
create schema if not exists sas_private;
revoke all on schema sas_private from public, anon, authenticated;
create table if not exists sas_private.designated_admin (
 singleton boolean primary key default true check (singleton),
 user_id uuid not null unique references auth.users(id) on delete restrict
);
alter table sas_private.designated_admin enable row level security;
revoke all on sas_private.designated_admin from public, anon, authenticated;
insert into sas_private.designated_admin(user_id)
 select id from public.profiles where role='admin'
 and not exists (select 1 from sas_private.designated_admin);

create or replace function public.guard_single_designated_school_admin()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.role='admin' and not exists(
  select 1 from sas_private.designated_admin where user_id=new.id
 ) then raise exception 'Administrator ist ausschließlich für das festgelegte Schulkonto erlaubt.'; end if;
 return new;
end;
$$;
revoke all on function public.guard_single_designated_school_admin() from public,anon,authenticated;

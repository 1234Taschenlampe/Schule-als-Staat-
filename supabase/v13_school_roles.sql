-- V13: immutable system-admin hierarchy + assignable school professions.
-- Core profiles.role remains the only source for financial/admin privileges.
create table if not exists public.school_job_roles (
  slug text primary key check (slug ~ '^[a-z][a-z0-9_]{2,31}$'),
  label text not null unique check(char_length(btrim(label)) between 3 and 65),
  description text not null default '' check(char_length(description)<=400),
  tier smallint not null default 10 check(tier in (10,30,80)),
  attendance_permission boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.school_role_assignments(
  user_id uuid not null references auth.users(id) on delete cascade,
  role_slug text not null references public.school_job_roles(slug) on delete restrict,
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  primary key(user_id,role_slug)
);
create index if not exists school_role_assignments_role_idx on public.school_role_assignments(role_slug);
alter table public.school_job_roles enable row level security;
alter table public.school_role_assignments enable row level security;
revoke all on public.school_job_roles,public.school_role_assignments from public,anon,authenticated;
insert into public.school_job_roles(slug,label,description,tier,attendance_permission) values
('operator','Operator','Organisiert Schulbetrieb, Schülerverifizierung und Abstimmungen. Keine Adminrechte.',80,true),
('attendance_controller','Anwesenheitskontrolle','Erfasst Anwesenheit vor Ort über den Schülerausweis.',30,true),
('journalist','Journalist','Berichtet über das Projekt Schule als Staat.',10,false),
('editor','Redaktion','Arbeitet an Mitteilungen und dem Schulblog.',10,false),
('seller','Verkäufer','Betreut einen Verkaufsstand. Keine Kassenfreigabe ohne Admin.',10,false),
('event_helper','Veranstaltungshelfer','Hilft bei Veranstaltungen und Organisation.',10,false),
('room_coordinator','Raumkoordination','Hilft bei Raumplanung und Betreuung.',10,false),
('lost_found','Fundbüro','Unterstützt bei gefundenen Gegenständen.',10,false),
('visa_helper','ViSA-Hilfe','Unterstützt im Ablauf ohne vertrauliche Antragsdaten.',10,false),
('election_helper','Wahlhelfer','Unterstützt Wahlen ohne Admin- oder Stimmrechte.',10,false),
('security_helper','Sicherheitsdienst','Unterstützt bei der Ordnung im Schulstaat.',10,false),
('tour_guide','Schulguide','Hilft Gästen, sich im Schulstaat zurechtzufinden.',10,false)
on conflict(slug) do nothing;

create or replace function public.sas_is_operator()
returns boolean language sql stable security definer set search_path=''
as $$
 select exists (
   select 1 from public.school_role_assignments r
   where r.user_id=(select auth.uid()) and r.role_slug='operator'
 );
$$;
revoke all on function public.sas_is_operator() from public,anon,authenticated;
grant execute on function public.sas_is_operator() to authenticated;

create or replace function public.sas_can_manage_school()
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin')
 or exists(select 1 from public.school_role_assignments r where r.user_id=(select auth.uid()) and r.role_slug='operator');
$$;
revoke all on function public.sas_can_manage_school() from public,anon,authenticated;
grant execute on function public.sas_can_manage_school() to authenticated;

create or replace function public.my_school_roles()
returns jsonb language sql stable security definer set search_path=''
as $$
 select jsonb_build_object(
  'operator',coalesce((select bool_or(r.role_slug='operator') from public.school_role_assignments r where r.user_id=(select auth.uid())),false),
  'can_check_attendance',public.sas_can_check_attendance(),
  'jobs',coalesce((select jsonb_agg(jsonb_build_object('slug',j.slug,'label',j.label,'tier',j.tier) order by j.label)
    from public.school_role_assignments a join public.school_job_roles j on j.slug=a.role_slug
    where a.user_id=(select auth.uid())),'[]'::jsonb)
 );
$$;
revoke all on function public.my_school_roles() from public,anon,authenticated;
grant execute on function public.my_school_roles() to authenticated;

create or replace function public.school_role_catalog()
returns jsonb language sql stable security definer set search_path=''
as $$
 select coalesce(jsonb_agg(jsonb_build_object('slug',j.slug,'label',j.label,'description',j.description,
  'tier',j.tier,'attendance_permission',j.attendance_permission) order by j.tier desc,j.label),'[]'::jsonb)
 from public.school_job_roles j where public.sas_can_manage_school();
$$;
revoke all on function public.school_role_catalog() from public,anon,authenticated;
grant execute on function public.school_role_catalog() to authenticated;

create or replace function public.school_role_find_students(p_query text)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_query text:=btrim(coalesce(p_query,''));v_data jsonb;
begin
 if not public.sas_can_manage_school() then raise exception 'Keine Rollenverwaltungsberechtigung.'; end if;
 if char_length(v_query)<2 or char_length(v_query)>100 then
  raise exception 'Bitte mindestens zwei Zeichen für die Mitgliedersuche eingeben.';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'email',u.email,
  'system_role',p.role,'verified',p.school_verified_at is not null,
  'jobs',coalesce((select jsonb_agg(a.role_slug order by a.role_slug)
   from public.school_role_assignments a where a.user_id=p.id),'[]'::jsonb))
  order by p.display_name),'[]'::jsonb) into v_data
 from (
  select p.id,p.display_name,p.role,p.school_verified_at
  from public.profiles p join auth.users u on u.id=p.id
  where p.display_name ilike '%'||v_query||'%' or u.email ilike '%'||v_query||'%'
  order by p.display_name limit 25
 ) p join auth.users u on u.id=p.id;
 return v_data;
end;
$$;
revoke all on function public.school_role_find_students(text) from public,anon,authenticated;
grant execute on function public.school_role_find_students(text) to authenticated;

create or replace function public.assign_school_role(p_user_id uuid,p_role_slug text,p_enabled boolean)
returns boolean language plpgsql volatile security definer set search_path=''
as $$
declare v_admin boolean;v_operator boolean;v_tier smallint;v_target_role text;
begin
 v_admin:=exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin');
 v_operator:=public.sas_is_operator();
 if not(v_admin or v_operator) then raise exception 'Du darfst keine Schulberufe zuweisen.'; end if;
 if p_enabled is null then raise exception 'Bitte An- oder Abwahl explizit auswählen.'; end if;
 if p_user_id is null then raise exception 'Mitglied fehlt.'; end if;
 if p_user_id=auth.uid() then raise exception 'Eigene Schulberufe darfst du nicht selbst verändern.'; end if;
 select tier into v_tier from public.school_job_roles where slug=p_role_slug;
 if v_tier is null then raise exception 'Unbekannter Schulberuf.'; end if;
 select role into v_target_role from public.profiles where id=p_user_id for update;
 if not found then raise exception 'Mitglied nicht vorhanden.'; end if;
 if not v_admin then
   if v_tier>=80 then raise exception 'Nur Admins dürfen Operatoren ernennen oder abberufen.'; end if;
   if v_target_role='admin' then raise exception 'Operatoren dürfen Admins nicht verwalten.'; end if;
   if exists(select 1 from public.school_role_assignments a
     where a.user_id=p_user_id and a.role_slug='operator') then
     raise exception 'Operatoren dürfen andere Operatoren nicht verwalten.';
   end if;
 end if;
 if p_enabled then
   insert into public.school_role_assignments(user_id,role_slug,assigned_by)
   values(p_user_id,p_role_slug,auth.uid())
   on conflict(user_id,role_slug) do nothing;
 else
   delete from public.school_role_assignments where user_id=p_user_id and role_slug=p_role_slug;
 end if;
 return true;
end;
$$;
revoke all on function public.assign_school_role(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.assign_school_role(uuid,text,boolean) to authenticated;

create or replace function public.create_school_job_role(p_slug text,p_label text,p_description text default '')
returns boolean language plpgsql volatile security definer set search_path=''
as $$
begin
 if not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin') then
   raise exception 'Nur Admins dürfen neue Berufsarten erstellen.';
 end if;
 insert into public.school_job_roles(slug,label,description,tier)
 values(lower(btrim(p_slug)),btrim(p_label),left(btrim(coalesce(p_description,'')),400),10);
 return true;
end;
$$;
revoke all on function public.create_school_job_role(text,text,text) from public,anon,authenticated;
grant execute on function public.create_school_job_role(text,text,text) to authenticated;

-- Keep attendance authorization consistent with assigned professions.
-- An operator or attendance controller can check attendance; ordinary jobs cannot.
create or replace function public.sas_can_check_attendance()
returns boolean language sql stable security definer set search_path=''
as $$
 select (select auth.uid()) is not null and (
   exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin')
   or exists(select 1 from public.attendance_checkers c where c.user_id=(select auth.uid()))
   or exists(select 1 from public.school_role_assignments a
     join public.school_job_roles j on j.slug=a.role_slug
     where a.user_id=(select auth.uid()) and j.attendance_permission)
 );
$$;
revoke all on function public.sas_can_check_attendance() from public,anon,authenticated;
grant execute on function public.sas_can_check_attendance() to authenticated;

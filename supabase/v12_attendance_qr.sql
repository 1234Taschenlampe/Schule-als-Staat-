-- SaS ONE | Attendance scanning for school project (sensitive minor attendance data).
-- DISTINCT from school identity verification. Requires school-verified student and authorized checker.
-- Server-side tokens are single-use, short-lived and hashed; no raw names/IDs in QR.
create table if not exists public.attendance_checkers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  appointed_by uuid not null references auth.users(id),
  appointed_at timestamptz not null default now()
);
create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 100),
  opened_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  ends_at timestamptz not null,
  closed_at timestamptz,
  check (ends_at > created_at and ends_at <= created_at + interval '8 hours')
);
create table if not exists public.attendance_scans (
  session_id uuid not null references public.attendance_sessions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  scanned_by uuid not null references auth.users(id),
  scanned_at timestamptz not null default now(),
  primary key(session_id,user_id)
);
create index if not exists attendance_scans_by_user on public.attendance_scans(user_id,scanned_at desc);
create table if not exists public.attendance_passes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check(expires_at > issued_at and expires_at <= issued_at + interval '2 minutes')
);
create index if not exists attendance_passes_expires on public.attendance_passes(expires_at);

alter table public.attendance_checkers enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_scans enable row level security;
alter table public.attendance_passes enable row level security;
revoke all on public.attendance_checkers,public.attendance_sessions,public.attendance_scans,public.attendance_passes from public,anon,authenticated;

create or replace function public.sas_can_check_attendance()
returns boolean language sql stable security definer set search_path=''
as $$
 select (select auth.uid()) is not null and (
  exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin')
  or exists(select 1 from public.attendance_checkers c where c.user_id=(select auth.uid()))
 );
$$;
revoke all on function public.sas_can_check_attendance() from public,anon,authenticated;
grant execute on function public.sas_can_check_attendance() to authenticated;

create or replace function public.manage_attendance_checker(p_user_id uuid,p_allow boolean)
returns boolean language plpgsql volatile security definer set search_path=''
as $$
begin
 if not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin') then
   raise exception 'Nur Administratoren dürfen Anwesenheitskontrolleure ernennen.';
 end if;
 if p_user_id is null or not exists(select 1 from public.profiles p where p.id=p_user_id) then
   raise exception 'Das Mitgliedskonto wurde nicht gefunden.';
 end if;
 if p_allow is true then
   insert into public.attendance_checkers(user_id,appointed_by)
   values(p_user_id,auth.uid())
   on conflict(user_id) do update set appointed_by=excluded.appointed_by,appointed_at=now();
 else
   delete from public.attendance_checkers where user_id=p_user_id;
 end if;
 return true;
end;
$$;
revoke all on function public.manage_attendance_checker(uuid,boolean) from public,anon,authenticated;
grant execute on function public.manage_attendance_checker(uuid,boolean) to authenticated;

create or replace function public.open_attendance_session(p_title text,p_minutes integer default 60)
returns uuid language plpgsql volatile security definer set search_path=''
as $$
declare v_id uuid;
begin
 if not public.sas_can_check_attendance() then raise exception 'Keine Berechtigung zur Anwesenheitskontrolle.'; end if;
 if char_length(btrim(coalesce(p_title,''))) not between 3 and 100 then
  raise exception 'Bitte eine verständliche Bezeichnung eingeben.';
 end if;
 if p_minutes is null or p_minutes not between 5 and 480 then raise exception 'Dauer muss 5 bis 480 Minuten betragen.'; end if;
 insert into public.attendance_sessions(title,opened_by,ends_at)
 values(btrim(p_title),auth.uid(),now()+make_interval(mins=>p_minutes))
 returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.open_attendance_session(text,integer) from public,anon,authenticated;
grant execute on function public.open_attendance_session(text,integer) to authenticated;

create or replace function public.list_attendance_sessions()
returns jsonb language sql stable security definer set search_path=''
as $$
 select case when public.sas_can_check_attendance() then coalesce(
   (select jsonb_agg(jsonb_build_object(
      'id',s.id,'title',s.title,'created_at',s.created_at,'ends_at',s.ends_at,
      'is_open',s.closed_at is null and s.ends_at>now(),
      'scans',(select count(*) from public.attendance_scans a where a.session_id=s.id)
    ) order by s.created_at desc)
    from (select * from public.attendance_sessions order by created_at desc limit 40) s),
  '[]'::jsonb)
 else '[]'::jsonb end;
$$;
revoke all on function public.list_attendance_sessions() from public,anon,authenticated;
grant execute on function public.list_attendance_sessions() to authenticated;

create or replace function public.close_attendance_session(p_session_id uuid)
returns boolean language plpgsql volatile security definer set search_path=''
as $$
begin
 if not public.sas_can_check_attendance() then raise exception 'Keine Berechtigung.'; end if;
 update public.attendance_sessions set closed_at=now()
 where id=p_session_id and closed_at is null and (
  opened_by=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
 );
 if not found then raise exception 'Termin nicht vorhanden oder nicht zum Schließen berechtigt.'; end if;
 return true;
end;
$$;
revoke all on function public.close_attendance_session(uuid) from public,anon,authenticated;
grant execute on function public.close_attendance_session(uuid) to authenticated;

create or replace function public.create_attendance_pass()
returns text language plpgsql volatile security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_token text;v_previous timestamptz;
begin
 if v_uid is null then raise exception 'Bitte zuerst anmelden.'; end if;
 if not exists (select 1 from public.profiles p where p.id=v_uid and p.school_verified_at is not null) then
  raise exception 'Deine Schulidentität muss zuerst vor Ort verifiziert werden.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,9043));
 select issued_at into v_previous from public.attendance_passes where user_id=v_uid;
 if v_previous is not null and v_previous>now()-interval '6 seconds' then
   raise exception 'Bitte warte einige Sekunden, bevor du den Code erneuerst.';
 end if;
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.attendance_passes(user_id,token_hash,issued_at,expires_at)
 values(v_uid,extensions.digest(v_token,'sha256'),now(),now()+interval '2 minutes')
 on conflict(user_id) do update set token_hash=excluded.token_hash,issued_at=excluded.issued_at,expires_at=excluded.expires_at;
 return 'SAS-ATTEND:'||v_token;
end;
$$;
revoke all on function public.create_attendance_pass() from public,anon,authenticated;
grant execute on function public.create_attendance_pass() to authenticated;

create or replace function public.scan_attendance_pass(p_code text,p_session_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare v_token text:=lower(btrim(coalesce(p_code,'')));v_uid uuid;v_name text;v_class text;v_inserted boolean:=false;
begin
 if not public.sas_can_check_attendance() then raise exception 'Keine Berechtigung zur Anwesenheitskontrolle.'; end if;
 if not exists(select 1 from public.attendance_sessions s where s.id=p_session_id and s.closed_at is null and s.ends_at>now()) then
  raise exception 'Bitte eine geöffnete Anwesenheitsliste auswählen.';
 end if;
 if left(v_token,11)='sas-attend:' then v_token:=substr(v_token,12); end if;
 if v_token !~ '^[0-9a-f]{64}$' then raise exception 'Ungültiger Anwesenheits-QR-Code.'; end if;
 select c.user_id into v_uid from public.attendance_passes c
 where c.token_hash=extensions.digest(v_token,'sha256') and c.expires_at>now()
 for update;
 if v_uid is null then raise exception 'QR-Code ist abgelaufen oder bereits verwendet.'; end if;
 select s.display_name,s.class_label into v_name,v_class from public.student_cards s
 join public.profiles p on p.id=s.user_id
 where s.user_id=v_uid and p.school_verified_at is not null;
 if v_name is null then raise exception 'Das Mitglied ist nicht schulisch verifiziert.'; end if;
 insert into public.attendance_scans(session_id,user_id,scanned_by)
 values(p_session_id,v_uid,auth.uid())
 on conflict(session_id,user_id) do nothing;
 v_inserted:=found;
 delete from public.attendance_passes where user_id=v_uid;
 return jsonb_build_object('ok',true,'already_present',not v_inserted,
  'display_name',v_name,'class_label',v_class);
end;
$$;
revoke all on function public.scan_attendance_pass(text,uuid) from public,anon,authenticated;
grant execute on function public.scan_attendance_pass(text,uuid) to authenticated;

create or replace function public.my_attendance_history()
returns jsonb language sql stable security definer set search_path=''
as $$
 select coalesce(jsonb_agg(jsonb_build_object('title',x.title,'scanned_at',x.scanned_at) order by x.scanned_at desc),'[]'::jsonb)
 from (
  select s.title,a.scanned_at
  from public.attendance_scans a join public.attendance_sessions s on s.id=a.session_id
  where a.user_id=(select auth.uid()) order by a.scanned_at desc limit 20
 ) x;
$$;
revoke all on function public.my_attendance_history() from public,anon,authenticated;
grant execute on function public.my_attendance_history() to authenticated;

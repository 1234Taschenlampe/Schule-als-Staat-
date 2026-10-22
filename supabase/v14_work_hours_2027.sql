-- Schule als Staat 2027: minimum 300 paid working minutes on EACH project day.
-- All times are recorded in Europe/Berlin; no cross-day offsetting.
create table if not exists public.work_shifts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 work_day date not null,
 started_at timestamptz not null default now(),
 ended_at timestamptz,
 started_by uuid not null references auth.users(id),
 ended_by uuid references auth.users(id),
 check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists work_shifts_one_open_per_user on public.work_shifts(user_id) where ended_at is null;
create index if not exists work_shifts_user_day on public.work_shifts(user_id,work_day);
create table if not exists public.work_scan_tokens (
 user_id uuid primary key references auth.users(id) on delete cascade,
 token_hash bytea not null unique,
 expires_at timestamptz not null
);
alter table public.work_shifts enable row level security;
alter table public.work_scan_tokens enable row level security;
revoke all on public.work_shifts,public.work_scan_tokens from public,anon,authenticated;

create or replace function public.work_is_checker()
returns boolean language sql stable security definer set search_path=''
as $$
 select (select auth.uid()) is not null and (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin')
 or exists(select 1 from public.school_role_assignments a where a.user_id=(select auth.uid()) and a.role_slug='operator')
 or exists(select 1 from public.school_role_assignments a join public.school_job_roles j on j.slug=a.role_slug where a.user_id=(select auth.uid()) and j.attendance_permission)
 or exists(select 1 from public.attendance_checkers c where c.user_id=(select auth.uid()))
 );
$$;
revoke all on function public.work_is_checker() from public,anon,authenticated;
grant execute on function public.work_is_checker() to authenticated;

create or replace function public.create_work_scan_token()
returns text language plpgsql volatile security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_token text;
begin
 if v_uid is null or not exists(select 1 from public.profiles p where p.id=v_uid and p.school_verified_at is not null)
 then raise exception 'Schulidentität muss zuerst bestätigt sein.'; end if;
 if (now() at time zone 'Europe/Berlin')::date not between date '2027-07-12' and date '2027-07-16'
 then raise exception 'Zeiterfassung nur vom 12. bis 16. Juli 2027 verfügbar.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,73421));
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.work_scan_tokens(user_id,token_hash,expires_at)
 values(v_uid,extensions.digest(v_token,'sha256'),now()+interval '2 minutes')
 on conflict(user_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at;
 return 'SAS-WORK:'||v_token;
end;
$$;
revoke all on function public.create_work_scan_token() from public,anon,authenticated;
grant execute on function public.create_work_scan_token() to authenticated;

create or replace function public.scan_work_token(p_code text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare v_uid uuid; v_code text:=lower(btrim(coalesce(p_code,''))); v_day date:=(now() at time zone 'Europe/Berlin')::date; v_shift public.work_shifts%rowtype; v_action text;
begin
 if not public.work_is_checker() then raise exception 'Keine Berechtigung zur Arbeitszeiterfassung.'; end if;
 if v_day not between date '2027-07-12' and date '2027-07-16' then raise exception 'Außerhalb der Projektwoche.'; end if;
 if left(v_code,9)='sas-work:' then v_code:=substr(v_code,10); end if;
 if v_code !~ '^[0-9a-f]{64}$' then raise exception 'Ungültiger Arbeits-QR-Code.'; end if;
 select user_id into v_uid from public.work_scan_tokens
 where token_hash=extensions.digest(v_code,'sha256') and expires_at>now() for update;
 if v_uid is null then raise exception 'Code abgelaufen oder schon verwendet.'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_uid and p.school_verified_at is not null)
 then raise exception 'Schülerkonto nicht verifiziert.'; end if;
 select * into v_shift from public.work_shifts where user_id=v_uid and ended_at is null for update;
 if found then
   if v_shift.work_day<>v_day then raise exception 'Offene Schicht vom Vortag: Verwaltung muss diese prüfen.'; end if;
   if now()-v_shift.started_at<interval '1 minute' then raise exception 'Erneuter Scan zu früh.'; end if;
   update public.work_shifts set ended_at=now(),ended_by=auth.uid() where id=v_shift.id;
   v_action:='ended';
 else
   insert into public.work_shifts(user_id,work_day,started_by) values(v_uid,v_day,auth.uid());
   v_action:='started';
 end if;
 delete from public.work_scan_tokens where user_id=v_uid;
 return jsonb_build_object('action',v_action,'work_day',v_day);
end;
$$;
revoke all on function public.scan_work_token(text) from public,anon,authenticated;
grant execute on function public.scan_work_token(text) to authenticated;

create or replace function public.my_work_hours()
returns jsonb language sql stable security definer set search_path=''
as $$
 select jsonb_build_object('daily_minimum_minutes',300,'required_days',5,'days',
 coalesce((select jsonb_agg(jsonb_build_object('date',d.day,'minutes',coalesce(x.minutes,0),
 'complete',coalesce(x.minutes,0)>=300,'open',coalesce(x.open,false)) order by d.day)
 from generate_series(date '2027-07-12',date '2027-07-16',interval '1 day') d(day)
 left join lateral (
 select floor(sum(extract(epoch from (coalesce(s.ended_at,least(now(),((s.work_day+1)::timestamp at time zone 'Europe/Berlin')))-s.started_at)))/60)::integer as minutes,
 bool_or(s.ended_at is null) as open
 from public.work_shifts s where s.user_id=(select auth.uid()) and s.work_day=d.day::date
 ) x on true),'[]'::jsonb));
$$;
revoke all on function public.my_work_hours() from public,anon,authenticated;
grant execute on function public.my_work_hours() to authenticated;

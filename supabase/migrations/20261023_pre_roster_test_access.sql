-- Temporary pre-roster project access, effective until the school roster is imported.
-- CAUTION: The account holder is not proof of a unique student. Test votes are not certified elections.
-- No admin, cashier, school-checker, or operator privileges are granted by this migration.
create table if not exists public.school_access_settings (
 singleton boolean primary key default true check(singleton),
 roster_enforced boolean not null default false,
 updated_at timestamptz not null default now()
);
insert into public.school_access_settings(singleton,roster_enforced) values(true,false)
on conflict(singleton) do update set roster_enforced=false,updated_at=now();
alter table public.school_access_settings enable row level security;
revoke all on table public.school_access_settings from public, anon, authenticated;

-- Privacy-preserving inventory of trial accounts (user IDs only).
-- It is NOT an automatic deletion list; manual review is required before cleanup.
create table if not exists public.school_test_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 recorded_at timestamptz not null default now(),
 cohort text not null default 'pre_roster_2026'
);
alter table public.school_test_accounts enable row level security;
revoke all on table public.school_test_accounts from public, anon, authenticated;
insert into public.school_test_accounts(user_id)
select p.id from public.profiles p where p.role='member'
on conflict(user_id) do nothing;

-- Existing trial members receive the same one-account-one-vote right as future signups.
-- Admin rights and other roles remain unchanged.
update public.profiles set vote_eligible=true where role='member';


-- on_new_user (retains existing identity and authorization boundaries)
CREATE OR REPLACE FUNCTION public.on_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text := left(btrim(coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(coalesce(new.email,''),'@',1),'Mitglied')),80);
  v_class text := left(btrim(coalesce(new.raw_user_meta_data->>'class_label','')),24);
begin
  if char_length(v_name)<2 then v_name:='Mitglied'; end if;

  insert into public.profiles(id,display_name,role,vote_eligible)
    values(new.id,v_name,'member',coalesce((select not s.roster_enforced from public.school_access_settings s where s.singleton),false))
    on conflict(id) do nothing;

  insert into public.wallets(user_id,balance_cents)
    values(new.id,0)
    on conflict(user_id) do nothing;

  insert into public.student_cards(user_id,display_name,class_label,design)
    values(new.id,v_name,v_class,'classic')
    on conflict(user_id) do nothing;

  if coalesce((select not s.roster_enforced from public.school_access_settings s where s.singleton),false) then
    insert into public.school_test_accounts(user_id) values(new.id) on conflict(user_id) do nothing;
  end if;

  return new;
end;
$function$


-- create_attendance_pass (retains existing identity and authorization boundaries)
CREATE OR REPLACE FUNCTION public.create_attendance_pass()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid();v_token text;v_previous timestamptz;
begin
 if v_uid is null then raise exception 'Bitte zuerst anmelden.'; end if;
 if not exists (select 1 from public.profiles p where p.id=v_uid and (coalesce((select (not s.roster_enforced) from public.school_access_settings s where s.singleton),false) or p.school_verified_at is not null)) then
  raise exception 'Dieses Konto hat noch keine Berechtigung zur Anwesenheit.';
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
$function$


-- scan_attendance_pass (retains existing identity and authorization boundaries)
CREATE OR REPLACE FUNCTION public.scan_attendance_pass(p_code text, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 where s.user_id=v_uid and (coalesce((select (not s.roster_enforced) from public.school_access_settings s where s.singleton),false) or p.school_verified_at is not null);
 if v_name is null then raise exception 'Das Mitglied hat keine gültige Teilnahmeberechtigung.'; end if;
 insert into public.attendance_scans(session_id,user_id,scanned_by)
 values(p_session_id,v_uid,auth.uid())
 on conflict(session_id,user_id) do nothing;
 v_inserted:=found;
 delete from public.attendance_passes where user_id=v_uid;
 return jsonb_build_object('ok',true,'already_present',not v_inserted,
  'display_name',v_name,'class_label',v_class);
end;
$function$


-- create_work_scan_token (retains existing identity and authorization boundaries)
CREATE OR REPLACE FUNCTION public.create_work_scan_token()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid(); v_token text;
begin
 if v_uid is null or not exists(select 1 from public.profiles p where p.id=v_uid and (coalesce((select (not s.roster_enforced) from public.school_access_settings s where s.singleton),false) or p.school_verified_at is not null))
 then raise exception 'Dieses Konto hat keine Berechtigung zur Zeiterfassung.'; end if;
 if (now() at time zone 'Europe/Berlin')::date not between date '2027-07-12' and date '2027-07-16'
 then raise exception 'Zeiterfassung nur vom 12. bis 16. Juli 2027 verfügbar.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,73421));
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.work_scan_tokens(user_id,token_hash,expires_at)
 values(v_uid,extensions.digest(v_token,'sha256'),now()+interval '2 minutes')
 on conflict(user_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at;
 return 'SAS-WORK:'||v_token;
end;
$function$


-- scan_work_token (retains existing identity and authorization boundaries)
CREATE OR REPLACE FUNCTION public.scan_work_token(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid; v_code text:=lower(btrim(coalesce(p_code,''))); v_day date:=(now() at time zone 'Europe/Berlin')::date; v_shift public.work_shifts%rowtype; v_action text;
begin
 if not public.work_is_checker() then raise exception 'Keine Berechtigung zur Arbeitszeiterfassung.'; end if;
 if v_day not between date '2027-07-12' and date '2027-07-16' then raise exception 'Außerhalb der Projektwoche.'; end if;
 if left(v_code,7)='sas-id:' then v_code:=substr(v_code,8); end if;
 select user_id into v_uid from public.student_card_codes where code=v_code;
 if v_uid is null then raise exception 'Unbekannter Schülerausweis.'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_uid and (coalesce((select (not s.roster_enforced) from public.school_access_settings s where s.singleton),false) or p.school_verified_at is not null))
 then raise exception 'Schülerkonto nicht zur Zeiterfassung berechtigt.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,73421));
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
 return jsonb_build_object('action',v_action,'work_day',v_day);
end;
$function$


-- Deprecated school-verification QR endpoints must not be callable by browsers
-- once the legacy UI is removed. These do not affect SAS-ID/attendance/credit QR.
revoke all on function public.create_school_verification_qr() from public, anon, authenticated;
revoke all on function public.review_school_verification_qr(text) from public, anon, authenticated;
revoke all on function public.confirm_school_verification_qr(text,boolean) from public, anon, authenticated;
revoke all on function public.my_school_verification_status() from public, anon, authenticated;

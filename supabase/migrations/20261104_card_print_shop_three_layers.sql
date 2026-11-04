-- SaS three-layer physical card shop. Source of truth for DB changes applied on 2026-11-04.
-- Existing long codes remain valid; new opaque 64-bit aliases are not public profile data.
alter table public.student_card_codes add column if not exists short_code text;
update public.student_card_codes set short_code=encode(extensions.gen_random_bytes(8),'hex') where short_code is null;
alter table public.student_card_codes alter column short_code set default encode(extensions.gen_random_bytes(8),'hex');
alter table public.student_card_codes alter column short_code set not null;
create unique index if not exists student_card_codes_short_code_unique on public.student_card_codes(short_code);
alter table public.student_card_codes add constraint student_card_codes_short_code_format check(short_code ~ '^[0-9a-f]{16}$');
create table if not exists public.printed_card_orders(
 user_id uuid primary key references auth.users(id) on delete cascade,
 status text not null default 'vorgemerkt'
  check(status in ('vorgemerkt','in_produktion','fertig','ausgegeben','storniert')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.printed_card_orders enable row level security;
revoke all on public.printed_card_orders from public,anon,authenticated;
-- No names or QR secrets are stored in the orders; sensitive lookup via admin-only RPCs.


CREATE OR REPLACE FUNCTION public.admin_credit_scanned_card(p_code text, p_amount_cents integer, p_operation_id uuid, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_admin uuid:=auth.uid();v_target uuid;v_receipt public.admin_credit_receipts%rowtype;
v_ledger uuid;v_code text:=lower(btrim(coalesce(p_code,'')));v_name text;
begin
 if v_admin is null or not exists(select 1 from public.profiles where id=v_admin and role='admin') then
 raise exception 'Keine Administratorberechtigung.';end if;
 if p_operation_id is null then raise exception 'Vorgangskennung fehlt.';end if;
 if p_amount_cents is null or p_amount_cents not between 1 and 1000000 then
 raise exception 'Betrag muss zwischen 0,01 und 10.000,00 liegen.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,9138));
 select * into v_receipt from public.admin_credit_receipts where operation_id=p_operation_id;
 if found then return jsonb_build_object('receipt_id',v_receipt.id,'ledger_id',v_receipt.ledger_id,'already_processed',true);end if;
 if left(v_code,7)='sas-id:' then v_code:=substr(v_code,8);end if;
 select sc.user_id,sas_private.decrypt_school_name(p.id) into v_target,v_name
 from public.student_card_codes sc join public.profiles p on p.id=sc.user_id
 where sc.code=v_code or sc.short_code=v_code;
 if v_target is null then raise exception 'Ausweis nicht gefunden.';end if;
 if v_target=v_admin then raise exception 'Keine Eigengutschrift über Ausweisscan.';end if;
 v_ledger:=public.issue_credits(v_target,p_amount_cents,left(coalesce(p_note,''),140));
 insert into public.admin_credit_receipts(operation_id,admin_id,recipient_id,amount_cents,ledger_id)
 values(p_operation_id,v_admin,v_target,p_amount_cents,v_ledger) returning * into v_receipt;
 return jsonb_build_object('receipt_id',v_receipt.id,'ledger_id',v_ledger,
 'recipient',v_name,'amount_cents',p_amount_cents,'already_processed',false);
end;
$function$

CREATE OR REPLACE FUNCTION public.admin_lookup_credit_card(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_code text:=lower(btrim(coalesce(p_code,'')));v_result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin')
 then raise exception 'Nur die Administration darf Guthaben ausgeben.';end if;
 if left(v_code,7)='sas-id:' then v_code:=substr(v_code,8);end if;
 if length(v_code)<12 or length(v_code)>200 then raise exception 'Ungültiger Ausweiscode.';end if;
 select jsonb_build_object('user_id',p.id,'display_name',sas_private.decrypt_school_name(p.id),
 'class_label',c.class_label,'school_verified',p.school_verified_at is not null)
 into v_result from public.student_card_codes sc
 join public.profiles p on p.id=sc.user_id
 left join public.student_cards c on c.user_id=p.id
 where sc.code=v_code or sc.short_code=v_code;
 if v_result is null then raise exception 'Ausweis nicht gefunden.';end if;
 return v_result;
end;
$function$

CREATE OR REPLACE FUNCTION public.admin_printed_card_data(p_login_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid;v_result jsonb;
begin
 if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
 then raise exception 'Nur Administratoren dürfen fremde Ausweise erzeugen.';end if;
 if p_login_id is null or p_login_id !~ '^SAS-[A-Z2-9]{10}$'
 then raise exception 'Ungültige Bürgerkennung.';end if;
 select user_id into v_user from public.school_roster_members
 where login_id=p_login_id and active=true;
 if v_user is null then raise exception 'Aktive Bürgerkennung nicht gefunden.';end if;
 insert into public.student_card_codes(user_id) values(v_user)
 on conflict(user_id) do nothing;
 select jsonb_build_object(
  'name',sas_private.decrypt_school_name(v_user),
  'class_label',r.class_label,'login_id',r.login_id,
  'qr_code','SAS-ID:'||sc.short_code,'design',coalesce(c.design,'classic'),
  'status',(select status from public.printed_card_orders where user_id=v_user))
 into v_result from public.school_roster_members r
 join public.student_card_codes sc on sc.user_id=r.user_id
 left join public.student_cards c on c.user_id=r.user_id
 where r.user_id=v_user;
 return v_result;
end;
$function$

CREATE OR REPLACE FUNCTION public.admin_printed_card_orders()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
 if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
 then raise exception 'Nur Administratoren dürfen Druckaufträge einsehen.';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'login_id',r.login_id,'class_label',r.class_label,'status',o.status,
  'created_at',o.created_at,'updated_at',o.updated_at
 ) order by o.created_at desc),'[]'::jsonb) into v_result
 from (select * from public.printed_card_orders order by created_at desc limit 100) o
 join public.school_roster_members r on r.user_id=o.user_id;
 return v_result;
end;
$function$

CREATE OR REPLACE FUNCTION public.admin_printed_card_status(p_login_id text, p_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid;
begin
 if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
 then raise exception 'Keine Administratorberechtigung.';end if;
 if p_status not in ('vorgemerkt','in_produktion','fertig','ausgegeben','storniert')
 then raise exception 'Ungültiger Status.';end if;
 select user_id into v_uid from public.school_roster_members
 where login_id=p_login_id and active=true;
 if v_uid is null then raise exception 'Bürgerkonto nicht gefunden.';end if;
 update public.printed_card_orders set status=p_status,updated_at=now()
 where user_id=v_uid;
 if not found then raise exception 'Keine Vormerkung vorhanden.';end if;
 return true;
end;
$function$

CREATE OR REPLACE FUNCTION public.cancel_printed_card()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 update public.printed_card_orders set status='storniert',updated_at=now()
 where user_id=auth.uid() and status='vorgemerkt';
 if not found then raise exception 'Nur eine noch nicht produzierte Vormerkung kann storniert werden.';end if;
 return true;
end;
$function$

CREATE OR REPLACE FUNCTION public.lookup_student_card(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_code text:=lower(btrim(coalesce(p_code,'')));v_result jsonb;
begin
 if not public.work_is_checker() then raise exception 'Keine Berechtigung zur Ausweisprüfung.';end if;
 if left(v_code,7)='sas-id:' then v_code:=substr(v_code,8);end if;
 select jsonb_build_object('display_name',sas_private.decrypt_school_name(p.id),'class_label',c.class_label,
 'school_verified',p.school_verified_at is not null,'user_id',p.id)
 into v_result from public.student_card_codes sc
 join public.profiles p on p.id=sc.user_id
 left join public.student_cards c on c.user_id=p.id
 where sc.code=v_code or sc.short_code=v_code;
 if v_result is null then raise exception 'Ausweis nicht gefunden.';end if;
 return v_result;
end;
$function$

CREATE OR REPLACE FUNCTION public.my_printed_card_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid();v_result jsonb;
begin
 if v_uid is null then raise exception 'Bitte anmelden.';end if;
 if not exists(select 1 from public.school_roster_members r where r.user_id=v_uid and r.active)
 then raise exception 'Ein aktives Bürgerkonto ist erforderlich.';end if;
 if exists(select 1 from auth.users u where u.id=v_uid
   and u.raw_app_meta_data->>'sas_initial_password'='true') then
   raise exception 'Bitte zuerst das Startpasswort ändern.';end if;
 insert into public.student_card_codes(user_id) values(v_uid)
 on conflict(user_id) do nothing;
 select jsonb_build_object(
  'name',sas_private.decrypt_school_name(v_uid),
  'class_label',r.class_label,
  'login_id',r.login_id,
  'qr_code','SAS-ID:'||sc.short_code,
  'design',coalesce(c.design,'classic'),
  'status',(select status from public.printed_card_orders where user_id=v_uid))
 into v_result from public.school_roster_members r
 join public.student_card_codes sc on sc.user_id=r.user_id
 left join public.student_cards c on c.user_id=r.user_id
 where r.user_id=v_uid and r.active;
 return v_result;
end;
$function$

CREATE OR REPLACE FUNCTION public.my_student_card_code()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid();v_code text;
begin
 if v_uid is null then raise exception 'Anmeldung erforderlich.';end if;
 insert into public.student_card_codes(user_id) values(v_uid) on conflict(user_id) do nothing;
 select short_code into v_code from public.student_card_codes where user_id=v_uid;
 return 'SAS-ID:'||v_code;
end;
$function$

CREATE OR REPLACE FUNCTION public.request_printed_card()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid();v_status text;
begin
 if v_uid is null then raise exception 'Bitte anmelden.';end if;
 if not exists(select 1 from public.school_roster_members r where r.user_id=v_uid and r.active)
 then raise exception 'Ein aktives Bürgerkonto ist erforderlich.';end if;
 if exists(select 1 from auth.users u where u.id=v_uid and u.raw_app_meta_data->>'sas_initial_password'='true')
 then raise exception 'Bitte zuerst das Startpasswort ändern.';end if;
 insert into public.printed_card_orders(user_id) values(v_uid) on conflict(user_id) do nothing;
 select status into v_status from public.printed_card_orders where user_id=v_uid for update;
 if v_status='storniert' then
  update public.printed_card_orders set status='vorgemerkt',updated_at=now() where user_id=v_uid;
  v_status:='vorgemerkt';
 end if;
 return jsonb_build_object('status',v_status,'payment_required',false,'binding',false);
end;
$function$

CREATE OR REPLACE FUNCTION public.scan_printed_card_attendance(p_code text, p_session_id uuid, p_identity_checked boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_code text:=lower(btrim(coalesce(p_code,'')));v_uid uuid;v_present boolean;
begin
 if not public.sas_can_check_attendance() then raise exception 'Nicht zur Anwesenheitskontrolle berechtigt.';end if;
 if p_identity_checked is distinct from true then raise exception 'Bitte die Person vor Ort anhand der Karte prüfen.';end if;
 if not exists(select 1 from public.attendance_sessions s
  where s.id=p_session_id and s.closed_at is null and s.ends_at>now())
 then raise exception 'Keine geöffnete Anwesenheitsliste.';end if;
 if left(v_code,7)='sas-id:' then v_code:=substr(v_code,8);end if;
 select sc.user_id into v_uid from public.student_card_codes sc
 join public.school_roster_members r on r.user_id=sc.user_id and r.active
 where sc.code=v_code or sc.short_code=v_code;
 if v_uid is null then raise exception 'Ausweis nicht gefunden.';end if;
 insert into public.attendance_scans(session_id,user_id,scanned_by)
 values(p_session_id,v_uid,auth.uid()) on conflict(session_id,user_id) do nothing;
 v_present:=found;
 return jsonb_build_object('ok',true,'already_present',not v_present,
 'display_name',sas_private.decrypt_school_name(v_uid));
end;
$function$

CREATE OR REPLACE FUNCTION public.scan_work_token(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid;v_code text:=lower(btrim(coalesce(p_code,'')));
v_day date:=(now() at time zone 'Europe/Berlin')::date;v_shift public.work_shifts%rowtype;v_action text;
begin
 if not public.work_is_checker() then raise exception 'Keine Berechtigung zur Arbeitszeiterfassung.';end if;
 if v_day not between date '2027-07-12' and date '2027-07-16' then raise exception 'Außerhalb der Projektwoche.';end if;
 if left(v_code,7)='sas-id:' then v_code:=substr(v_code,8);end if;
 select user_id into v_uid from public.student_card_codes
 where code=v_code or short_code=v_code;
 if v_uid is null then raise exception 'Unbekannter Schülerausweis.';end if;
 if not exists(select 1 from public.profiles p where p.id=v_uid and p.school_verified_at is not null)
 then raise exception 'Schülerkonto nicht verifiziert.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,73421));
 select * into v_shift from public.work_shifts where user_id=v_uid and ended_at is null for update;
 if found then
  if v_shift.work_day<>v_day then raise exception 'Offene Schicht vom Vortag: Verwaltung muss diese prüfen.';end if;
  if now()-v_shift.started_at<interval '1 minute' then raise exception 'Erneuter Scan zu früh.';end if;
  update public.work_shifts set ended_at=now(),ended_by=auth.uid() where id=v_shift.id;
  v_action:='ended';
 else
  insert into public.work_shifts(user_id,work_day,started_by) values(v_uid,v_day,auth.uid());
  v_action:='started';
 end if;
 return jsonb_build_object('action',v_action,'work_day',v_day);
end;
$function$

revoke all on function public.admin_credit_scanned_card(p_code text, p_amount_cents integer, p_operation_id uuid, p_note text) from public,anon,authenticated;
grant execute on function public.admin_credit_scanned_card(p_code text, p_amount_cents integer, p_operation_id uuid, p_note text) to authenticated;
revoke all on function public.admin_lookup_credit_card(p_code text) from public,anon,authenticated;
grant execute on function public.admin_lookup_credit_card(p_code text) to authenticated;
revoke all on function public.admin_printed_card_data(p_login_id text) from public,anon,authenticated;
grant execute on function public.admin_printed_card_data(p_login_id text) to authenticated;
revoke all on function public.admin_printed_card_orders() from public,anon,authenticated;
grant execute on function public.admin_printed_card_orders() to authenticated;
revoke all on function public.admin_printed_card_status(p_login_id text, p_status text) from public,anon,authenticated;
grant execute on function public.admin_printed_card_status(p_login_id text, p_status text) to authenticated;
revoke all on function public.cancel_printed_card() from public,anon,authenticated;
grant execute on function public.cancel_printed_card() to authenticated;
revoke all on function public.lookup_student_card(p_code text) from public,anon,authenticated;
grant execute on function public.lookup_student_card(p_code text) to authenticated;
revoke all on function public.my_printed_card_data() from public,anon,authenticated;
grant execute on function public.my_printed_card_data() to authenticated;
revoke all on function public.my_student_card_code() from public,anon,authenticated;
grant execute on function public.my_student_card_code() to authenticated;
revoke all on function public.request_printed_card() from public,anon,authenticated;
grant execute on function public.request_printed_card() to authenticated;
revoke all on function public.scan_printed_card_attendance(p_code text, p_session_id uuid, p_identity_checked boolean) from public,anon,authenticated;
grant execute on function public.scan_printed_card_attendance(p_code text, p_session_id uuid, p_identity_checked boolean) to authenticated;
revoke all on function public.scan_work_token(p_code text) from public,anon,authenticated;
grant execute on function public.scan_work_token(p_code text) to authenticated;

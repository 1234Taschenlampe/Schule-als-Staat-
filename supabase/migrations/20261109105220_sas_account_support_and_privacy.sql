-- Allocate an alias for future roster imports without touching existing aliases.
create function sas_private.sas_assign_short_login_id()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  candidate text;
  entropy bytea;
begin
  if new.short_login_id is not null then return new; end if;
  perform pg_advisory_xact_lock(82903);
  for attempt in 1..100 loop
    entropy := extensions.gen_random_bytes(4);
    candidate := 'SAS-' || lpad(((
      get_byte(entropy,0)::bigint * 16777216 + get_byte(entropy,1)::bigint * 65536
      + get_byte(entropy,2)::bigint * 256 + get_byte(entropy,3)
    ) % 1000000)::text,6,'0');
    if not exists (select 1 from public.school_roster_members r where r.short_login_id = candidate) then
      new.short_login_id := candidate;
      return new;
    end if;
  end loop;
  raise exception 'Could not allocate a unique short citizen ID';
end;
$$;
revoke all on function sas_private.sas_assign_short_login_id() from public,anon,authenticated;
create trigger sas_assign_short_login_id before insert on public.school_roster_members
for each row execute function sas_private.sas_assign_short_login_id();

-- Complete the existing rollout without rerunning the alias backfill.
alter table public.school_password_reset_audit
  add column status text not null default 'completed' check (status in ('reserved','completed'));
revoke all on public.school_password_reset_audit from public, anon, authenticated;

create function public.sas_account_support(p_actor uuid, p_session uuid, p_login text, p_reset boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  account record;
  attempt uuid;
begin
  if not exists (
    select 1 from public.profiles p
    join auth.sessions s on s.user_id = p.id and s.id = p_session
    where p.id = p_actor and p.role = 'admin' and coalesce(s.not_after > now(), true)
  ) then
    return jsonb_build_object('status','forbidden');
  end if;
  if p_login is null or p_login !~ '^SAS-([0-9]{6}|[A-Z2-9]{10})$' or p_reset is null then
    return jsonb_build_object('status','missing');
  end if;

  select r.user_id, coalesce(r.short_login_id,r.login_id) as login_id,
    r.active, p.role, coalesce(u.banned_until > now(),false) as banned,
    u.raw_app_meta_data->>'sas_initial_password' = 'true' as temporary
  into account
  from public.school_roster_members r
  join public.profiles p on p.id = r.user_id
  join auth.users u on u.id = r.user_id and u.deleted_at is null
  where r.short_login_id = p_login or r.login_id = p_login;

  if not found or account.role = 'admin' or account.user_id = p_actor then
    return jsonb_build_object('status','missing');
  end if;
  if not p_reset then
    return jsonb_build_object('login_id',account.login_id,'status',case
      when not account.active or account.banned then 'inactive'
      when account.temporary then 'temporary'
      else 'active' end);
  end if;
  if not account.active or account.banned then
    return jsonb_build_object('status','blocked');
  end if;

  -- Lock both counters before reserving the attempt, across tabs and edge isolates.
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,82901));
  perform pg_advisory_xact_lock(hashtextextended(account.user_id::text,82902));
  if (select count(*) from public.school_password_reset_audit
      where performed_by = p_actor and reset_at > clock_timestamp() - interval '10 minutes') >= 10
    or exists (select 1 from public.school_password_reset_audit
      where target_user_id = account.user_id and reset_at > clock_timestamp() - interval '2 minutes') then
    return jsonb_build_object('status','limited');
  end if;
  insert into public.school_password_reset_audit(target_user_id,performed_by,reset_at,status)
  values (account.user_id,p_actor,clock_timestamp(),'reserved') returning id into attempt;
  return jsonb_build_object('status','reserved','login_id',account.login_id,
    'target',account.user_id,'attempt',attempt);
end;
$$;
revoke all on function public.sas_account_support(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.sas_account_support(uuid,uuid,text,boolean) to service_role;

-- Auth Admin updates the password and app metadata in one transaction. The
-- existing password trigger clears the flag on a password change. The trusted
-- metadata operation reinstates it and closes the matching audit reservation.
create function sas_private.sas_complete_account_reset()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  reset_id uuid;
begin
  reset_id := (new.raw_app_meta_data->>'sas_support_attempt')::uuid;
  update public.school_password_reset_audit a
  set status = 'completed', reset_at = clock_timestamp()
  where a.id = reset_id and a.target_user_id = new.id and a.status = 'reserved'
    and a.reset_at > clock_timestamp() - interval '90 seconds'
    and exists (select 1 from public.profiles p where p.id = a.performed_by and p.role = 'admin')
    and exists (select 1 from public.profiles p where p.id = new.id and p.role <> 'admin')
    and exists (select 1 from public.school_roster_members r where r.user_id = new.id and r.active);
  if not found then raise exception 'Invalid account reset reservation' using errcode = '42501'; end if;
  new.raw_app_meta_data := (new.raw_app_meta_data - 'sas_support_attempt')
    || '{"sas_initial_password":true}'::jsonb;
  return new;
end;
$$;
revoke all on function sas_private.sas_complete_account_reset() from public,anon,authenticated;
create trigger sas_complete_account_reset before update of raw_app_meta_data on auth.users
for each row when (new.raw_app_meta_data ? 'sas_support_attempt')
execute function sas_private.sas_complete_account_reset();

-- PostgREST normally accepts unexpired JWTs after Auth revokes sessions. Check
-- revoked sessions for reset accounts and gate portal use until rotation.
create function public.sas_check_reset_session()
returns void language plpgsql stable security definer set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  session_id text := auth.jwt()->>'session_id';
  latest_reset timestamptz;
begin
  if viewer is null then return; end if;
  select a.reset_at into latest_reset from public.school_password_reset_audit a
  where a.target_user_id = viewer and a.status = 'completed'
  order by a.reset_at desc limit 1;
  if latest_reset is null then return; end if;
  if session_id is null or not exists (
    select 1 from auth.sessions s
    where s.id = session_id::uuid and s.user_id = viewer and s.created_at >= latest_reset
      and coalesce(s.not_after > now(),true)
  ) then
    raise sqlstate 'PT401' using message = 'Bitte melde dich erneut an.';
  end if;
  if coalesce(current_setting('request.path', true),'') not in (
    '/rpc/acknowledge_school_legal','/rpc/my_school_deletion_status','/rpc/request_my_school_data_deletion'
  ) and exists (select 1 from auth.users u where u.id = viewer
      and u.raw_app_meta_data->>'sas_initial_password' = 'true') then
    raise sqlstate 'PT403' using message = 'Bitte ändere zuerst dein Startpasswort.';
  end if;
end;
$$;
revoke all on function public.sas_check_reset_session() from public;
grant execute on function public.sas_check_reset_session() to anon,authenticated,service_role;
alter role authenticator set pgrst.db_pre_request = 'public.sas_check_reset_session';
notify pgrst, 'reload config';

-- Keep the flag collection and ballots. Match the table access rules to the portal.
alter policy school_competitions_visible on public.school_competitions
  using ((select public.sas_is_admin()));
alter policy school_competition_entries_visible on public.school_competition_entries
  using (approved and (select public.sas_is_admin()));
CREATE OR REPLACE FUNCTION public.admin_close_poll(p_poll_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.sas_is_admin() then
    raise exception 'Nur die Administration darf Abstimmungen schließen.' using errcode='42501';
  end if;
  update public.polls set status='closed',closed_at=now()
  where id=p_poll_id and status='open';
  if not found then raise exception 'Abstimmung nicht gefunden oder bereits geschlossen.'; end if;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_poll(p_title text, p_description text, p_options text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_id uuid; v_n int; v_option text; v_index int := 0;
begin
  if v_uid is null or not public.sas_is_admin() then
    raise exception 'Nur die Administration darf Abstimmungen erstellen.' using errcode='42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 5 and 160 then
    raise exception 'Titel muss zwischen 5 und 160 Zeichen lang sein.';
  end if;
  if p_options is null then raise exception 'Mindestens zwei Optionen erforderlich.'; end if;
  v_n:=coalesce(array_length(p_options,1),0);
  if v_n<2 or v_n>10 or array_ndims(p_options)<>1 then
    raise exception 'Es müssen 2 bis 10 Antwortoptionen angegeben werden.';
  end if;
  if exists(select 1 from unnest(p_options) as v(choice) where v.choice is null or char_length(btrim(v.choice)) not between 1 and 100) then
    raise exception 'Antwortoptionen müssen zwischen 1 und 100 Zeichen lang sein.';
  end if;
  if (select count(distinct lower(btrim(v.choice))) from unnest(p_options) as v(choice))<>v_n then
    raise exception 'Doppelte Antwortoptionen sind nicht erlaubt.';
  end if;
  insert into public.polls(title,description,created_by)
    values(btrim(p_title),left(coalesce(p_description,''),500),v_uid) returning id into v_id;
  foreach v_option in array p_options loop
    v_index:=v_index+1;
    insert into public.poll_options(poll_id,label,sort_order) values(v_id,btrim(v_option),v_index);
  end loop;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_poll_results()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_data jsonb;
begin
  if v_uid is null or not public.sas_is_admin() then
    raise exception 'Nur Administratoren sehen die Live-Auswertung.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',p.id,'title',p.title,'status',p.status,
      'total', (select count(*) from public.poll_ballots b where b.poll_id=p.id),
      'options',coalesce((
        select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,
          'count',(select count(*) from public.poll_ballots b where b.poll_id=p.id and b.option_id=o.id)
        ) order by o.sort_order)
        from public.poll_options o where o.poll_id=p.id
      ),'[]'::jsonb)
    ) order by p.created_at desc
  ),'[]'::jsonb) into v_data
  from (select * from public.polls order by created_at desc limit 50) p;
  return v_data;
end;
$function$;

CREATE OR REPLACE FUNCTION public.poll_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_result jsonb;
begin
  if not public.sas_is_admin() then raise exception 'Nur Administratoren haben Zugriff auf Abstimmungen.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',p.id,'title',p.title,'description',p.description,
      'status',p.status,'created_at',p.created_at,
      'options',coalesce((
        select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label) order by o.sort_order)
        from public.poll_options o where o.poll_id=p.id
      ),'[]'::jsonb),
      'has_voted',exists(select 1 from public.poll_ballots b where b.poll_id=p.id and b.voter_id=v_uid)
    ) order by p.created_at desc
  ),'[]'::jsonb) into v_result
  from (select * from public.polls order by created_at desc limit 50) p;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_vote(p_poll_id uuid, p_option_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=(select auth.uid()); v_status text;
BEGIN
  IF NOT public.sas_is_admin() THEN RAISE EXCEPTION 'Nur Administratoren dürfen abstimmen.' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=v_uid AND p.vote_eligible=true AND p.role='admin'
  ) THEN
    RAISE EXCEPTION 'Dieses Konto ist nicht für die offizielle Abstimmung berechtigt.'
      USING ERRCODE='42501';
  END IF;
  -- The start PIN is a temporary bootstrap secret. The auth.users trigger
  -- clears sas_initial_password only after the password hash really changes.
  IF EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id=v_uid AND u.raw_app_meta_data->>'sas_initial_password'='true'
  ) THEN
    RAISE EXCEPTION 'Bitte ändere zuerst dein einmaliges Startpasswort.'
      USING ERRCODE='42501';
  END IF;

  SELECT p.status INTO v_status FROM public.polls p WHERE p.id=p_poll_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Abstimmung nicht gefunden.'; END IF;
  IF v_status<>'open' THEN RAISE EXCEPTION 'Abstimmung ist geschlossen.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.poll_options o
    WHERE o.id=p_option_id AND o.poll_id=p_poll_id
  ) THEN RAISE EXCEPTION 'Antwortoption gehört nicht zu dieser Abstimmung.'; END IF;
  INSERT INTO public.poll_ballots(poll_id,voter_id,option_id)
  VALUES(p_poll_id,v_uid,p_option_id);
  RETURN true;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Du hast bereits abgestimmt.';
END
$function$;

-- Keep the payment and permanent QR contracts while returning citizen identifiers.
CREATE OR REPLACE FUNCTION public.lookup_payment_request(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_data jsonb;
begin
  if v_uid is null then raise exception 'Anmeldung erforderlich.'; end if;
  select jsonb_build_object(
    'id',r.id,'amount_cents',r.amount_cents,'note',r.note,
    'cashier_name',coalesce(citizen.short_login_id,citizen.login_id,'Kasse'),'expires_at',r.expires_at
  ) into v_data
  from public.payment_requests r join public.profiles p on p.id=r.cashier_id
  left join public.school_roster_members citizen on citizen.user_id=p.id
  where r.id=p_request_id and r.status='pending' and r.expires_at>now() and r.cashier_id<>v_uid;
  if v_data is null then raise exception 'Zahlungsanforderung ungültig, abgelaufen oder bereits bezahlt.'; end if;
  return v_data;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_credit_scanned_card(p_code text, p_amount_cents integer, p_operation_id uuid, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_admin uuid:=auth.uid();v_target uuid;v_receipt public.admin_credit_receipts%rowtype;
v_ledger uuid;v_code text:=lower(btrim(coalesce(p_code,'')));v_login text;
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
 select sc.user_id,coalesce(r.short_login_id,r.login_id,'Bürgerkonto') into v_target,v_login
 from public.student_card_codes sc join public.profiles p on p.id=sc.user_id
 left join public.school_roster_members r on r.user_id=p.id
 where sc.code=v_code or sc.short_code=v_code;
 if v_target is null then raise exception 'Ausweis nicht gefunden.';end if;
 if v_target=v_admin then raise exception 'Keine Eigengutschrift über Ausweisscan.';end if;
 v_ledger:=public.issue_credits(v_target,p_amount_cents,left(coalesce(p_note,''),140));
 insert into public.admin_credit_receipts(operation_id,admin_id,recipient_id,amount_cents,ledger_id)
 values(p_operation_id,v_admin,v_target,p_amount_cents,v_ledger) returning * into v_receipt;
 return jsonb_build_object('receipt_id',v_receipt.id,'ledger_id',v_ledger,
 'recipient',v_login,'amount_cents',p_amount_cents,'already_processed',false);
end;
$function$;

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
 select jsonb_build_object('login_id',coalesce(r.short_login_id,r.login_id,'Bürgerkonto'),
 'school_verified',p.school_verified_at is not null,'user_id',p.id)
 into v_result from public.student_card_codes sc
 join public.profiles p on p.id=sc.user_id
 left join public.school_roster_members r on r.user_id=p.id
 where sc.code=v_code or sc.short_code=v_code;
 if v_result is null then raise exception 'Ausweis nicht gefunden.';end if;
 return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_school_deletion_requests()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=(select auth.uid()); v_data jsonb;
begin
 if v_uid is null or not exists (select 1 from public.profiles where id=v_uid and role='admin')
 then raise exception 'Nur Administration' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'user_id',q.user_id,'login_id',coalesce(r.short_login_id,r.login_id,'Unbekannt'),
   'status',q.status,'requested_at',q.requested_at,
   'reason_code',q.reason_code
 ) order by q.requested_at asc),'[]'::jsonb)
 into v_data
 from (select * from sas_private.school_deletion_requests
       where status in ('beantragt','in_pruefung')
       order by requested_at asc limit 150) q
 left join public.school_roster_members r on r.user_id=q.user_id;
 return v_data;
end $function$;

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
  'login_id',coalesce(r.short_login_id,r.login_id),
  'qr_code','SAS-ID:'||sc.short_code,
  'design',coalesce(c.design,'classic'),
  'status',(select status from public.printed_card_orders where user_id=v_uid))
 into v_result from public.school_roster_members r
 join public.student_card_codes sc on sc.user_id=r.user_id
 left join public.student_cards c on c.user_id=r.user_id
 where r.user_id=v_uid and r.active;
 return v_result;
end;
$function$;

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
  'login_id',coalesce(r.short_login_id,r.login_id),
  'qr_code','SAS-ID:'||sc.short_code,'design',coalesce(c.design,'classic'),
  'status',(select status from public.printed_card_orders where user_id=v_user))
 into v_result from public.school_roster_members r
 join public.student_card_codes sc on sc.user_id=r.user_id
 left join public.student_cards c on c.user_id=r.user_id
 where r.user_id=v_user;
 return v_result;
end;
$function$;

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
 select jsonb_build_object('user_id',p.id,'login_id',coalesce(r.short_login_id,r.login_id,'Bürgerkonto'),'school_verified',p.school_verified_at is not null)
 into v_result from public.student_card_codes sc
 join public.profiles p on p.id=sc.user_id
 left join public.school_roster_members r on r.user_id=p.id
 where sc.code=v_code or sc.short_code=v_code;
 if v_result is null then raise exception 'Ausweis nicht gefunden.';end if;
 return v_result;
end;
$function$;

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
 'login_id',(select coalesce(r.short_login_id,r.login_id) from public.school_roster_members r where r.user_id=v_uid));
end;
$function$;

CREATE OR REPLACE FUNCTION public.scan_attendance_pass(p_code text, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_token text:=lower(btrim(coalesce(p_code,'')));v_uid uuid;v_login text;v_inserted boolean:=false;
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
 select coalesce(r.short_login_id,r.login_id,'Bürgerkonto') into v_login from public.student_cards s
 join public.profiles p on p.id=s.user_id
 left join public.school_roster_members r on r.user_id=s.user_id
 where s.user_id=v_uid and (coalesce((select (not s.roster_enforced) from public.school_access_settings s where s.singleton),false) or p.school_verified_at is not null);
 if v_login is null then raise exception 'Das Mitglied hat keine gültige Teilnahmeberechtigung.'; end if;
 insert into public.attendance_scans(session_id,user_id,scanned_by)
 values(p_session_id,v_uid,auth.uid())
 on conflict(session_id,user_id) do nothing;
 v_inserted:=found;
 delete from public.attendance_passes where user_id=v_uid;
 return jsonb_build_object('ok',true,'already_present',not v_inserted,
  'login_id',v_login);
end;
$function$;

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
  'login_id',coalesce(r.short_login_id,r.login_id),'status',o.status,
  'created_at',o.created_at,'updated_at',o.updated_at
 ) order by o.created_at desc),'[]'::jsonb) into v_result
 from (select * from public.printed_card_orders order by created_at desc limit 100) o
 join public.school_roster_members r on r.user_id=o.user_id;
 return v_result;
end;
$function$;

create or replace function public.admin_printed_card_status(p_login_id text, p_status text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  target uuid;
  login text := upper(btrim(p_login_id));
begin
  if not public.sas_is_admin() then
    raise exception 'Keine Administratorberechtigung.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('vorgemerkt','in_produktion','fertig','ausgegeben','storniert') then
    raise exception 'Ungültiger Status.';
  end if;
  select r.user_id into target from public.school_roster_members r
  where r.active and (r.login_id = login or r.short_login_id = login);
  if target is null then raise exception 'Bürgerkonto nicht gefunden.'; end if;
  update public.printed_card_orders set status = p_status, updated_at = now() where user_id = target;
  if not found then raise exception 'Keine Vormerkung vorhanden.'; end if;
  return true;
end;
$$;

-- Retain unused legacy functions for maintenance, without browser execution.
revoke execute on function public.admin_list_users(), public.my_secure_school_name(),
  public.school_role_find_students(text), public.attendance_session_roster(uuid)
  from public,anon,authenticated;

-- The portal reads design and account status, never legacy identity fields.
revoke select on public.profiles, public.student_cards from public,anon,authenticated;
grant select (id,role,vote_eligible,school_verified_at) on public.profiles to authenticated;
grant select (user_id,design,updated_at) on public.student_cards to authenticated;

notify pgrst, 'reload schema';


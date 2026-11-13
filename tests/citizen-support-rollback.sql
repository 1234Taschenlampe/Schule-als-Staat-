-- Run after the migration in a test transaction as the database owner.
-- The caller must roll back. No credential changes or identifiers are emitted.
do $verify$
declare
  member record;
  administrator uuid;
  admin_session uuid:=gen_random_uuid();
  member_session uuid:=gen_random_uuid();
  recovery_session uuid:=gen_random_uuid();
  account jsonb;
  reservation uuid;
  roster_id text;
  caller uuid;
  original_balance bigint;
  original_ledger bigint;
  old_qr text;
  old_short_qr text;
  card jsonb;
  poll_id uuid;
  option_id uuid;
  role_name text;
  payment_id uuid;
  payment jsonb;
begin
  select p.id into strict administrator from public.profiles p where p.role='admin';
  select r.user_id,r.login_id,r.short_login_id into strict member
  from public.school_roster_members r join public.student_card_codes c on c.user_id=r.user_id
  where r.active and r.user_id<>administrator
    and not exists(select from sas_private.school_deletion_requests d where d.user_id=r.user_id)
  limit 1;
  select balance_cents into strict original_balance from public.wallets where user_id=member.user_id;
  select count(*) into original_ledger from public.wallet_ledger where payer_id=member.user_id or payee_id=member.user_id;
  select code,short_code into strict old_qr,old_short_qr from public.student_card_codes where user_id=member.user_id;

  select short_login_id into strict roster_id from public.school_roster_members where user_id<>member.user_id limit 1;
  begin
    update public.school_roster_members set short_login_id=roster_id where user_id=member.user_id;
    raise exception 'Duplicate short ID accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.school_roster_members set short_login_id='SAS-INVALID' where user_id=member.user_id;
    raise exception 'Malformed short ID accepted';
  exception when check_violation then null;
  end;

  insert into auth.sessions(id,user_id,created_at,updated_at)
  values (admin_session,administrator,now(),now()),(member_session,member.user_id,now(),now());

  account:=public.sas_account_support(administrator,admin_session,member.login_id,false);
  if account->>'login_id' is distinct from member.short_login_id or account->>'status' not in ('active','temporary') then
    raise exception 'Legacy lookup failed';
  end if;
  if account is distinct from public.sas_account_support(administrator,admin_session,member.short_login_id,false) then
    raise exception 'Short and legacy lookups differ';
  end if;
  if (public.sas_account_support(member.user_id,member_session,member.short_login_id,true)->>'status') is distinct from 'forbidden' then
    raise exception 'Member could request a reset';
  end if;
  if (public.sas_account_support(administrator,member_session,member.short_login_id,true)->>'status') is distinct from 'forbidden' then
    raise exception 'Admin ID accepted with another session';
  end if;
  if has_function_privilege('authenticated','public.sas_account_support(uuid,uuid,text,boolean)','execute')
     or has_table_privilege('authenticated','public.school_password_reset_audit','select')
     or has_column_privilege('authenticated','public.student_cards','display_name','select')
     or has_column_privilege('authenticated','public.student_cards','class_label','select')
     or has_column_privilege('authenticated','public.profiles','display_name','select') then
    raise exception 'Sensitive RPC, audit or column is accessible';
  end if;

  -- Exercise the audit trigger without writing any password or hash.
  account:=public.sas_account_support(administrator,admin_session,member.short_login_id,true);
  reservation:=(account->>'attempt')::uuid;
  if reservation is null then raise exception 'Reset could not be reserved'; end if;
  if (public.sas_account_support(administrator,admin_session,member.short_login_id,true)->>'status') is distinct from 'limited' then
    raise exception 'Immediate repeated reset was accepted';
  end if;
  update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('sas_support_attempt',reservation)
  where id=member.user_id;
  if not exists(select from public.school_password_reset_audit where id=reservation and status='completed') then
    raise exception 'Reset audit was not finalized';
  end if;
  if not exists(select from auth.users where id=member.user_id
      and raw_app_meta_data->>'sas_initial_password'='true' and not raw_app_meta_data ? 'sas_support_attempt') then
    raise exception 'Forced rotation flag was not applied';
  end if;

  -- Simulate GoTrue's session revocation and fresh sign-in for Data API checks.
  delete from auth.sessions where id=member_session;
  insert into auth.sessions(id,user_id,created_at,updated_at) values (recovery_session,member.user_id,clock_timestamp(),clock_timestamp());
  perform set_config('request.jwt.claim.sub',member.user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member.user_id,'session_id',member_session)::text,true);
  begin
    perform public.sas_check_reset_session();
    raise exception 'Revoked session was accepted';
  exception when sqlstate 'PT401' then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member.user_id,'session_id',recovery_session)::text,true);
  perform set_config('request.path','/wallets',true);
  begin
    perform public.sas_check_reset_session();
    raise exception 'Wallet was available before password rotation';
  exception when sqlstate 'PT403' then null;
  end;
  perform set_config('request.path','/rpc/acknowledge_school_legal',true);
  perform public.sas_check_reset_session();

  -- Admin can create, see, vote and close. Direct access for each other role
  -- is checked with the same PostgREST role and different application roles.
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',administrator,'session_id',admin_session)::text,true);
  set local role authenticated;
  poll_id:=public.admin_create_poll('Rollback verification poll','',array['Option A','Option B']);
  select (entry->'options'->0->>'id')::uuid into strict option_id
  from jsonb_array_elements(public.poll_catalog()) entry where entry->>'id'=poll_id::text;
  perform public.submit_vote(poll_id,option_id);
  perform public.admin_close_poll(poll_id);
  if jsonb_typeof(public.admin_poll_results())<>'array' then raise exception 'Admin results failed'; end if;
  if not exists(select from public.school_competitions where slug='state_flag') then
    raise exception 'Admin flag access failed';
  end if;
  reset role;

  foreach role_name in array array['student','operator','cashier'] loop
    if role_name='operator' then
      select user_id into strict caller from public.school_role_assignments where role_slug='operator' limit 1;
    else
      caller:=member.user_id;
      if role_name='cashier' then update public.profiles set role='cashier' where id=caller; end if;
    end if;
    perform set_config('request.jwt.claim.sub',caller::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',caller)::text,true);
    set local role authenticated;
    if exists(select from public.school_competitions) or exists(select from public.school_competition_entries) then
      raise exception 'Flag entries accessible to %',role_name;
    end if;
    begin
      perform public.poll_catalog();
      raise exception 'Poll catalogue accessible to %',role_name;
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.submit_vote(poll_id,option_id);
      raise exception 'Voting accessible to %',role_name;
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.admin_poll_results();
      raise sqlstate 'ZX002';
    exception when raise_exception or insufficient_privilege then null;
    end;
    reset role;
  end loop;

  perform set_config('request.jwt.claim.sub',administrator::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',administrator)::text,true);
  set local role authenticated;
  card:=public.admin_printed_card_data_ids(member.short_login_id);
  if card ? 'name' or card ? 'class_label' or card->>'login_id' is distinct from member.short_login_id
     or lower(card->>'qr_code') is distinct from 'sas-id:'||old_short_qr then
    raise exception 'Printed card export leaked data or changed its QR';
  end if;
  if (public.lookup_student_card('SAS-ID:'||old_qr)->>'login_id') is distinct from member.short_login_id
     or (public.lookup_student_card('SAS-ID:'||old_short_qr)->>'login_id') is distinct from member.short_login_id then
    raise exception 'An existing QR could not be resolved';
  end if;
  reset role;
  -- Test the payment lookup and idempotent settlement in a savepoint.
  begin
    update public.wallets set balance_cents=1000 where user_id=administrator;
    perform set_config('request.jwt.claim.sub',member.user_id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',member.user_id)::text,true);
    set local role authenticated;
    payment_id:=public.create_payment_request(250,'Rollback verification');
    perform set_config('request.jwt.claim.sub',administrator::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',administrator)::text,true);
    payment:=public.lookup_payment_request(payment_id);
    if payment->>'cashier_name' is distinct from member.short_login_id then
      raise exception 'Payment lookup did not display the cashier citizen ID';
    end if;
    payment:=public.settle_payment_request(payment_id);
    if payment->>'already_paid' is distinct from 'false' then raise exception 'First settlement failed'; end if;
    payment:=public.settle_payment_request(payment_id);
    if payment->>'already_paid' is distinct from 'true' then raise exception 'Repeated settlement failed'; end if;
    if (select balance_cents from public.wallets where user_id=administrator)<>750 then
      raise exception 'Unexpected balance after payment';
    end if;
    reset role;
    raise sqlstate 'ZX003';
  exception when sqlstate 'ZX003' then null;
  end;

  if (select balance_cents from public.wallets where user_id=member.user_id) is distinct from original_balance
     or (select count(*) from public.wallet_ledger where payer_id=member.user_id or payee_id=member.user_id) is distinct from original_ledger then
    raise exception 'Reset affected wallet or history';
  end if;
end $verify$;

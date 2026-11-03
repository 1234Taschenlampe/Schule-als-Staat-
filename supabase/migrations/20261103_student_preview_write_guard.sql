-- School State: pre-launch student preview (03 November 2026).
-- Standard student accounts may use polls, student ID and account settings.
-- Operations for locked modules are denied even when called directly via REST/RPC.
-- Existing admin/cashier/operator/assigned school roles retain the old permission model.
-- This migration does not grant roles, enable registrations or expose student data.
-- This is a temporary launch guard: remove it in a reviewed release at the official start.
create schema if not exists sas_private;
revoke all on schema sas_private from public, anon, authenticated;

create or replace function sas_private.sas_student_preview_write_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  -- Trusted back-office tasks without an end-user JWT are not student actions.
  -- Ordinary pupils have system role "member" and no delegated school roles.
  if v_uid is not null
     and exists (
       select 1 from public.profiles p where p.id = v_uid and p.role = 'member'
     )
     and not exists (
       select 1 from public.school_role_assignments a where a.user_id = v_uid
     ) then
    raise exception 'Dieser Bereich wird erst zum offiziellen Start freigeschaltet.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function sas_private.sas_student_preview_write_guard()
  from public, anon, authenticated;

-- Do not install this guard on student_cards, student_card_codes,
-- profiles, student_onboarding, polls, poll_options, poll_ballots or
-- school_competition_entries: those are needed for the open preview.
do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'wallets', 'payment_requests', 'wallet_ledger', 'cash_sales',
    'room_bookings', 'event_rsvps', 'lost_items', 'job_applications',
    'school_self_jobs', 'school_shop_stalls', 'shop_products',
    'shop_stock_movements', 'shop_sales', 'shop_sale_items',
    'work_shifts', 'work_scan_tokens', 'attendance_passes',
    'attendance_scans', 'attendance_sessions'
  ] loop
    execute format(
      'drop trigger if exists sas_student_preview_write_guard on public.%I',
      v_table
    );
    execute format(
      'create trigger sas_student_preview_write_guard before insert or update or delete on public.%I ' ||
      'for each row execute function sas_private.sas_student_preview_write_guard()',
      v_table
    );
  end loop;
end
$migration$;

-- The school-wide polls teaser closes after 03 December 2026 in Berlin time.
-- Only the initial-pupil preview is affected; privileged accounts retain their
-- normal polling rights and the event's published poll data is not deleted.
create or replace function sas_private.sas_student_preview_poll_cutoff_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if (clock_timestamp() at time zone 'Europe/Berlin') >= timestamp '2026-12-04 00:00:00'
     and v_uid is not null
     and exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'member')
     and not exists (
       select 1 from public.school_role_assignments a where a.user_id = v_uid
     ) then
    raise exception 'Die Abstimmungsphase zum Nikolausmarkt ist beendet.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function sas_private.sas_student_preview_poll_cutoff_guard()
  from public, anon, authenticated;
drop trigger if exists sas_student_preview_poll_cutoff_guard on public.poll_ballots;
create trigger sas_student_preview_poll_cutoff_guard
  before insert or update on public.poll_ballots
  for each row execute function sas_private.sas_student_preview_poll_cutoff_guard();

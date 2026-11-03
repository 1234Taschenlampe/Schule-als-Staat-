-- 2026-11-03: user-facing school legal acknowledgement and individual erasure request.
-- Reproducible definitions of the production changes.
-- Does NOT erase accounts or override statutory retention rules.
create schema if not exists sas_private;
revoke all on schema sas_private from public,anon,authenticated;

create table if not exists sas_private.school_legal_acknowledgements (
 user_id uuid primary key references auth.users(id) on delete cascade,
 notice_version text not null,
 rules_version text not null,
 notice_read_ack boolean not null check(notice_read_ack),
 rules_accepted boolean not null check(rules_accepted),
 acknowledged_at timestamptz not null default now()
);
alter table sas_private.school_legal_acknowledgements enable row level security;
revoke all on sas_private.school_legal_acknowledgements from public,anon,authenticated;

create or replace function public.school_legal_status()
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v_uid uuid:=(select auth.uid());v_required boolean;v_ack boolean;
begin
 if v_uid is null then raise exception 'Anmeldung erforderlich' using errcode='42501'; end if;
 select exists(select 1 from public.school_roster_members r where r.user_id=v_uid and r.active) into v_required;
 select exists(select 1 from sas_private.school_legal_acknowledgements a
  where a.user_id=v_uid and a.notice_version='2026-11-03'
   and a.rules_version='2026-11-03' and a.notice_read_ack and a.rules_accepted) into v_ack;
 return jsonb_build_object('required',v_required,'acknowledged',v_ack,
  'needs_acknowledgement',(v_required and not v_ack),
  'notice_version','2026-11-03','rules_version','2026-11-03');
end $fn$;
revoke all on function public.school_legal_status() from public,anon,authenticated;
grant execute on function public.school_legal_status() to authenticated;

create or replace function public.acknowledge_school_legal(p_notice_read boolean,p_rules_accepted boolean)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_uid uuid:=(select auth.uid());
begin
 if v_uid is null then raise exception 'Anmeldung erforderlich' using errcode='42501';end if;
 if p_notice_read is distinct from true or p_rules_accepted is distinct from true
 then raise exception 'Beide Bestätigungen sind erforderlich' using errcode='22023';end if;
 if not exists(select 1 from public.school_roster_members r where r.user_id=v_uid and r.active)
 then raise exception 'Kein aktives Schulkonto' using errcode='42501';end if;
 insert into sas_private.school_legal_acknowledgements
 (user_id,notice_version,rules_version,notice_read_ack,rules_accepted,acknowledged_at)
 values(v_uid,'2026-11-03','2026-11-03',true,true,now())
 on conflict(user_id) do update set notice_version=excluded.notice_version,
 rules_version=excluded.rules_version,notice_read_ack=true,rules_accepted=true,
 acknowledged_at=case when
 sas_private.school_legal_acknowledgements.notice_version=excluded.notice_version
 and sas_private.school_legal_acknowledgements.rules_version=excluded.rules_version
 then sas_private.school_legal_acknowledgements.acknowledged_at
 else excluded.acknowledged_at end;
 return jsonb_build_object('acknowledged',true,'notice_version','2026-11-03',
  'rules_version','2026-11-03');
end $fn$;
revoke all on function public.acknowledge_school_legal(boolean,boolean) from public,anon,authenticated;
grant execute on function public.acknowledge_school_legal(boolean,boolean) to authenticated;

create or replace function sas_private.school_legal_voting_guard()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_uid uuid:=(select auth.uid());
begin
 if v_uid is not null and exists(select 1 from public.school_roster_members r where r.user_id=v_uid and r.active)
 and not exists(select 1 from sas_private.school_legal_acknowledgements a where a.user_id=v_uid
  and a.notice_version='2026-11-03' and a.rules_version='2026-11-03'
  and a.notice_read_ack and a.rules_accepted)
 then raise exception 'Datenschutzhinweise und Nutzungsregeln erst bestätigen' using errcode='42501';end if;
 return new;
end $fn$;
revoke all on function sas_private.school_legal_voting_guard() from public,anon,authenticated;
drop trigger if exists sas_school_legal_voting_guard on public.poll_ballots;
create trigger sas_school_legal_voting_guard before insert or update on public.poll_ballots
 for each row execute function sas_private.school_legal_voting_guard();

create table if not exists sas_private.school_deletion_requests (
 user_id uuid primary key references auth.users(id) on delete cascade,
 reason_code text not null default 'keine_angabe'
  check(reason_code in ('keine_angabe','datenschutz','nicht_mehr_nutzen','sonstiges')),
 status text not null default 'beantragt'
  check(status in ('beantragt','in_pruefung','erledigt','abgelehnt')),
 requested_at timestamptz not null default now(),
 processed_at timestamptz,
 decision_note text
);
alter table sas_private.school_deletion_requests enable row level security;
revoke all on sas_private.school_deletion_requests from public,anon,authenticated;

create or replace function public.my_school_deletion_status()
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v_uid uuid:=(select auth.uid());v_status text;v_at timestamptz;
begin
 if v_uid is null then raise exception 'Anmeldung erforderlich' using errcode='42501';end if;
 select status,requested_at into v_status,v_at from sas_private.school_deletion_requests where user_id=v_uid;
 return jsonb_build_object('requested',v_status is not null,'status',v_status,'requested_at',v_at);
end $fn$;
revoke all on function public.my_school_deletion_status() from public,anon,authenticated;
grant execute on function public.my_school_deletion_status() to authenticated;

create or replace function public.request_my_school_data_deletion(p_reason text default 'keine_angabe')
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_uid uuid:=(select auth.uid());v_status text;v_at timestamptz;
begin
 if v_uid is null then raise exception 'Anmeldung erforderlich' using errcode='42501';end if;
 if not exists(select 1 from public.school_roster_members where user_id=v_uid)
 then raise exception 'Keine zugeordnete Schulkennung' using errcode='42501';end if;
 if coalesce(p_reason,'keine_angabe') not in
 ('keine_angabe','datenschutz','nicht_mehr_nutzen','sonstiges')
 then raise exception 'Unbekannte Auswahl' using errcode='22023';end if;
 insert into sas_private.school_deletion_requests(user_id,reason_code,status)
 values(v_uid,coalesce(p_reason,'keine_angabe'),'beantragt')
 on conflict(user_id) do nothing;
 select status,requested_at into v_status,v_at from sas_private.school_deletion_requests where user_id=v_uid;
 update public.profiles set vote_eligible=false where id=v_uid and vote_eligible=true;
 return jsonb_build_object('requested',true,'status',v_status,'requested_at',v_at);
end $fn$;
revoke all on function public.request_my_school_data_deletion(text) from public,anon,authenticated;
grant execute on function public.request_my_school_data_deletion(text) to authenticated;

create or replace function sas_private.school_deletion_voting_guard()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_uid uuid:=(select auth.uid());
begin
 if v_uid is not null and exists(select 1 from sas_private.school_deletion_requests
  where user_id=v_uid and status in ('beantragt','in_pruefung','erledigt'))
 then raise exception 'Datenlöschungsantrag: Abstimmung gesperrt' using errcode='42501';end if;
 return new;
end $fn$;
revoke all on function sas_private.school_deletion_voting_guard() from public,anon,authenticated;
drop trigger if exists sas_school_deletion_voting_guard on public.poll_ballots;
create trigger sas_school_deletion_voting_guard before insert or update on public.poll_ballots
 for each row execute function sas_private.school_deletion_voting_guard();

create or replace function public.admin_list_school_deletion_requests()
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v_uid uuid:=(select auth.uid());v_data jsonb;
begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role='admin')
 then raise exception 'Nur Administration' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'user_id',q.user_id,'login_id',coalesce(r.login_id,'Unbekannt'),
  'status',q.status,'requested_at',q.requested_at,'reason_code',q.reason_code)
  order by q.requested_at asc),'[]'::jsonb) into v_data
 from (select * from sas_private.school_deletion_requests
   where status in ('beantragt','in_pruefung') order by requested_at asc limit 150) q
 left join public.school_roster_members r on r.user_id=q.user_id;
 return v_data;
end $fn$;
revoke all on function public.admin_list_school_deletion_requests() from public,anon,authenticated;
grant execute on function public.admin_list_school_deletion_requests() to authenticated;

create or replace function public.admin_review_school_deletion_request(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_admin uuid:=(select auth.uid());v_count integer;
begin
 if v_admin is null or not exists(select 1 from public.profiles where id=v_admin and role='admin')
 then raise exception 'Nur Administration' using errcode='42501';end if;
 if p_user_id is null then raise exception 'Keine Konto-ID angegeben';end if;
 update sas_private.school_deletion_requests set status='in_pruefung'
 where user_id=p_user_id and status='beantragt';
 get diagnostics v_count=row_count;
 if v_count<>1 then raise exception 'Antrag nicht gefunden oder bereits in Bearbeitung';end if;
 return jsonb_build_object('ok',true,'status','in_pruefung');
end $fn$;
revoke all on function public.admin_review_school_deletion_request(uuid) from public,anon,authenticated;
grant execute on function public.admin_review_school_deletion_request(uuid) to authenticated;

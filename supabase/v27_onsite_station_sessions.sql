-- Scoped station accounts: password never grants citizen privileges.
begin;
create table sas_onsite.station_sessions (
 station_id uuid primary key references sas_onsite.stations(id) on delete cascade,
 key_hash bytea not null unique,
 expires_at timestamptz not null default now()+interval '12 hours'
);
alter table sas_onsite.station_sessions enable row level security;
revoke all on sas_onsite.station_sessions from public,anon,authenticated;
create or replace function public.onsite_visa_access(p_action text,p_key text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s sas_onsite.stations%rowtype; p sas_onsite.passes%rowtype;
 cfg sas_onsite.settings%rowtype; from_day date; to_day date; req uuid; guest_hash bytea; session_key text;
begin
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_input is null or length(p_input::text)>2048 then
  raise exception 'Ungültiger Zugang.' using errcode='42501';
 end if;
 if p_action='guest_status' then
  select * into p from sas_onsite.passes where guest_key_hash=extensions.digest(p_key,'sha256');
  if not found then raise exception 'Ungültiger Zugang.' using errcode='42501'; end if;
  return jsonb_build_object('status',sas_onsite.pass_status(p),'valid_from',p.valid_from,'valid_to',p.valid_to,'price_cents',p.price_cents,'paid',p.paid_at is not null);
 end if;
 if p_action='station_login' then
  select * into s from sas_onsite.stations where active and key_hash=extensions.digest(p_key,'sha256')
   and (upper(btrim(p_input->>'username'))='VISA-'||upper(id::text)
     or (label ~ '^ViSA-Station 0[1-4]$' and upper(btrim(p_input->>'username'))=upper(replace(label,' ','-')))) for update;
  if not found then raise exception 'Ungültiger Zugang.' using errcode='42501'; end if;
  delete from sas_onsite.station_sessions where station_id=s.id;
  session_key:=encode(extensions.gen_random_bytes(32),'hex');
  insert into sas_onsite.station_sessions(station_id,key_hash) values(s.id,extensions.digest(session_key,'sha256'));
  return jsonb_build_object('role','visa_station','session',session_key,'station',s.label);
 end if;
 if p_action not in ('station_quote','station_create','station_logout') then raise exception 'Ungültige Anfrage.'; end if;
 select st.* into s from sas_onsite.stations st join sas_onsite.station_sessions ss on ss.station_id=st.id
  where st.active and ss.expires_at>now() and ss.key_hash=extensions.digest(p_key,'sha256') for update of st;
 if not found then raise exception 'Ungültiger Zugang.' using errcode='42501'; end if;
 if p_action='station_logout' then
  delete from sas_onsite.station_sessions where station_id=s.id and key_hash=extensions.digest(p_key,'sha256');
  return jsonb_build_object('ok',true);
 end if;
 select * into strict cfg from sas_onsite.settings where singleton;
 if p_action='station_quote' then
  return jsonb_build_object('role','visa_station','enabled',cfg.enabled,'station',s.label,'daily_price_cents',cfg.daily_price_cents,'valid_from','2027-07-12','valid_to','2027-07-16');
 end if;
 if not cfg.enabled then raise exception 'ViSA nicht freigegeben.' using errcode='42501'; end if;
 if coalesce(p_input->>'guest_key','') !~ '^[a-f0-9]{64}$' then raise exception 'Ungültiger Gastschlüssel.'; end if;
 guest_hash:=extensions.digest(p_input->>'guest_key','sha256');
 req:=(p_input->>'request_id')::uuid;
 from_day:=(p_input->>'valid_from')::date;
 to_day:=(p_input->>'valid_to')::date;
 if req is null or from_day is null or to_day is null or from_day<date '2027-07-12' or to_day>date '2027-07-16' or to_day<from_day or from_day<(now() at time zone 'Europe/Berlin')::date then
  raise exception 'Ungültiger Zeitraum.';
 end if;
 select * into p from sas_onsite.passes where station_id=s.id and request_id=req;
 if found then
  if p.guest_key_hash<>guest_hash or p.valid_from<>from_day or p.valid_to<>to_day then raise exception 'Antragsschlüssel bereits verwendet.'; end if;
 else
  if (select count(*) from sas_onsite.passes where station_id=s.id and created_at>now()-interval '1 minute')>=60 then
   raise exception 'Stationslimit erreicht.' using errcode='54000';
  end if;
  insert into sas_onsite.passes(station_id,request_id,guest_key_hash,valid_from,valid_to,price_cents)
  values(s.id,req,guest_hash,from_day,to_day,(to_day-from_day+1)*cfg.daily_price_cents) returning * into p;
 end if;
 return jsonb_build_object('id',p.id,'price_cents',p.price_cents,'valid_from',p.valid_from,'valid_to',p.valid_to,'expires_at',p.expires_at,'status',sas_onsite.pass_status(p));
end $$;
revoke all on function public.onsite_visa_access(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.onsite_visa_access(text,text,jsonb) to service_role;

-- Every staff action checks the real authenticated identity and current role.
create or replace function public.onsite_visa_staff(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); administrator boolean; p sas_onsite.passes%rowtype;
 cfg sas_onsite.settings%rowtype; secret text; sid uuid; result jsonb;
begin
 if actor is null or p_input is null or length(p_input::text)>4096 or
 exists(select 1 from auth.users where id=actor and raw_app_meta_data->>'sas_initial_password'='true')
 then raise exception 'Keine Berechtigung.' using errcode='42501'; end if;
 administrator:=exists(select 1 from public.profiles where id=actor and role='admin');
 if (administrator or public.sas_is_operator()) is distinct from true then raise exception 'Keine Berechtigung.' using errcode='42501'; end if;
 if p_action='access' then return jsonb_build_object('role',case when administrator then 'admin' else 'operator' end); end if;
 if p_action in ('configure','station_add','station_revoke','report','refund') and not administrator then
  raise exception 'Nur Administration.' using errcode='42501';
 end if;
 if p_action='configure' then
  update sas_onsite.settings set enabled=(p_input->>'enabled')::boolean,daily_price_cents=(p_input->>'daily_price_cents')::integer where singleton;
  return jsonb_build_object('ok',true);
 elsif p_action='station_add' then
  secret:=encode(extensions.gen_random_bytes(32),'hex');
  insert into sas_onsite.stations(label,key_hash,created_by) values(btrim(p_input->>'label'),extensions.digest(secret,'sha256'),actor) returning id into sid;
  return jsonb_build_object('station_id',sid,'username','VISA-'||upper(sid::text),'station_key',secret);
 elsif p_action='station_revoke' then
  update sas_onsite.stations set active=false where id=(p_input->>'station_id')::uuid;
  if not found then raise exception 'Station nicht gefunden.'; end if;
  return jsonb_build_object('ok',true);
 elsif p_action='report' then
  select * into strict cfg from sas_onsite.settings where singleton;
  return jsonb_build_object('enabled',cfg.enabled,'daily_price_cents',cfg.daily_price_cents,
   'gross_cents',(select coalesce(sum(price_cents),0) from sas_onsite.passes where paid_at is not null),
   'refund_cents',(select coalesce(sum(amount_cents),0) from sas_onsite.refunds),
   'stations',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'active',active)),'[]'::jsonb) from sas_onsite.stations),
   'recent',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'price_cents',x.price_cents,'status',sas_onsite.pass_status(x),'paid_at',x.paid_at,'paid_by',x.paid_by,'valid_from',x.valid_from,'valid_to',x.valid_to)),'[]'::jsonb) from (select * from sas_onsite.passes order by created_at desc limit 100) x));
 end if;
 if p_action not in ('lookup','confirm','refund') then raise exception 'Ungültige Aktion.'; end if;
 select * into p from sas_onsite.passes where id=(p_input->>'id')::uuid for update;
 if not found then raise exception 'Antrag nicht gefunden.'; end if;
 if p_action='confirm' then
  if p_input->'verified' is distinct from 'true'::jsonb or p_input->'cash_received' is distinct from 'true'::jsonb or
    (p_input->>'amount_cents')::integer is distinct from p.price_cents then
   raise exception 'Verifizierung oder Bargeldbetrag fehlt.';
  end if;
  if exists(select 1 from sas_onsite.refunds where pass_id=p.id) then raise exception 'Antrag storniert.'; end if;
  if p.paid_at is null then
   select * into strict cfg from sas_onsite.settings where singleton;
   if not cfg.enabled or p.expires_at<=now() or not exists(select 1 from sas_onsite.stations where id=p.station_id and active) then
    raise exception 'Antrag abgelaufen oder deaktiviert.';
   end if;
   update sas_onsite.passes set paid_at=now(),paid_by=actor where id=p.id returning * into p;
  end if;
 elsif p_action='refund' then
  if p.paid_at is null or p_input->'cash_returned' is distinct from 'true'::jsonb then raise exception 'Bargeldrückgabe nicht bestätigt.'; end if;
  insert into sas_onsite.refunds(pass_id,amount_cents,reason,recorded_by)
   values(p.id,p.price_cents,btrim(p_input->>'reason'),actor) on conflict(pass_id) do nothing;
 end if;
 return jsonb_build_object('id',p.id,'price_cents',p.price_cents,'status',sas_onsite.pass_status(p),'valid_from',p.valid_from,'valid_to',p.valid_to,'paid_at',p.paid_at,'paid_by',p.paid_by);
end $$;
revoke all on function public.onsite_visa_staff(text,jsonb) from public,anon,authenticated;
grant execute on function public.onsite_visa_staff(text,jsonb) to authenticated;
commit;

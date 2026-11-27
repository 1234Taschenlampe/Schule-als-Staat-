-- On-site visitor admissions. No public registration, school-account provisioning,
-- wallet grants or external payments. Disabled until the school approves live use.
begin;
create schema if not exists sas_onsite;
revoke all on schema sas_onsite from public, anon, authenticated;
create table if not exists sas_onsite.settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  daily_price_cents integer check(daily_price_cents between 1 and 10000),
  check(not enabled or daily_price_cents is not null)
);
insert into sas_onsite.settings default values on conflict (singleton) do nothing;
create table if not exists sas_onsite.stations (
  id uuid primary key default gen_random_uuid(),
  label text not null check(length(label) between 1 and 60),
  key_hash bytea not null unique,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table sas_onsite.settings enable row level security;
alter table sas_onsite.stations enable row level security;
revoke all on sas_onsite.settings, sas_onsite.stations from public, anon, authenticated;
create table sas_onsite.passes (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references sas_onsite.stations(id),
  request_id uuid not null,
  guest_key_hash bytea not null unique,
  valid_from date not null,
  valid_to date not null,
  price_cents integer not null check(price_cents between 1 and 50000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '20 minutes',
  paid_at timestamptz,
  paid_by uuid references auth.users(id),
  unique(station_id,request_id),
  check(valid_from between date '2027-07-12' and date '2027-07-16'),
  check(valid_to between valid_from and date '2027-07-16'),
  check((paid_at is null)=(paid_by is null))
);
create index onsite_pass_created_idx on sas_onsite.passes(created_at);
create table sas_onsite.refunds (
  pass_id uuid primary key references sas_onsite.passes(id),
  amount_cents integer not null check(amount_cents>0),
  reason text not null check(length(reason) between 3 and 200),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);
alter table sas_onsite.settings enable row level security;
alter table sas_onsite.stations enable row level security;
alter table sas_onsite.passes enable row level security;
alter table sas_onsite.refunds enable row level security;
revoke all on all tables in schema sas_onsite from public,anon,authenticated;

create function sas_onsite.pass_status(p sas_onsite.passes)
returns text language sql stable set search_path='' as $$
 select case
  when exists(select 1 from sas_onsite.refunds r where r.pass_id=p.id) then 'refunded'
  when p.paid_at is null then case when p.expires_at<=now() then 'expired' else 'pending' end
  when (now() at time zone 'Europe/Berlin')::date<p.valid_from then 'booked'
  when (now() at time zone 'Europe/Berlin')::date>p.valid_to then 'expired'
  else 'active' end
$$;
revoke all on function sas_onsite.pass_status(sas_onsite.passes) from public,anon,authenticated;

-- Service-role-only boundary for station credentials and isolated visitor passes.
create function public.onsite_visa_access(p_action text,p_key text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s sas_onsite.stations%rowtype; p sas_onsite.passes%rowtype;
 cfg sas_onsite.settings%rowtype; from_day date; to_day date; req uuid; guest_hash bytea;
begin
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_input is null or length(p_input::text)>2048 then
  raise exception 'Ungültiger Zugang.' using errcode='42501';
 end if;
 if p_action='guest_status' then
  select * into p from sas_onsite.passes where guest_key_hash=extensions.digest(p_key,'sha256');
  if not found then raise exception 'Ungültiger Zugang.' using errcode='42501'; end if;
  return jsonb_build_object('status',sas_onsite.pass_status(p),'valid_from',p.valid_from,'valid_to',p.valid_to,'price_cents',p.price_cents,'paid',p.paid_at is not null);
 end if;
 if p_action not in ('station_quote','station_create') then raise exception 'Ungültige Anfrage.'; end if;
 select * into s from sas_onsite.stations where key_hash=extensions.digest(p_key,'sha256') and active for update;
 if not found then raise exception 'Ungültiger Zugang.' using errcode='42501'; end if;
 select * into strict cfg from sas_onsite.settings where singleton;
 if not cfg.enabled then raise exception 'ViSA nicht freigegeben.' using errcode='42501'; end if;
 if p_action='station_quote' then
  return jsonb_build_object('daily_price_cents',cfg.daily_price_cents,'valid_from','2027-07-12','valid_to','2027-07-16');
 end if;
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
create function public.onsite_visa_staff(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); administrator boolean; p sas_onsite.passes%rowtype;
 cfg sas_onsite.settings%rowtype; secret text; sid uuid; result jsonb;
begin
 if actor is null or p_input is null or length(p_input::text)>4096 or
 exists(select 1 from auth.users where id=actor and raw_app_meta_data->>'sas_initial_password'='true')
 then raise exception 'Keine Berechtigung.' using errcode='42501'; end if;
 administrator:=exists(select 1 from public.profiles where id=actor and role='admin');
 if not(administrator or public.sas_is_operator()) then raise exception 'Keine Berechtigung.' using errcode='42501'; end if;
 if p_action in ('configure','station_add','station_revoke','report','refund') and not administrator then
  raise exception 'Nur Administration.' using errcode='42501';
 end if;
 if p_action='configure' then
  update sas_onsite.settings set enabled=(p_input->>'enabled')::boolean,daily_price_cents=(p_input->>'daily_price_cents')::integer where singleton;
  return jsonb_build_object('ok',true);
 elsif p_action='station_add' then
  secret:=encode(extensions.gen_random_bytes(32),'hex');
  insert into sas_onsite.stations(label,key_hash,created_by) values(btrim(p_input->>'label'),extensions.digest(secret,'sha256'),actor) returning id into sid;
  return jsonb_build_object('station_id',sid,'station_key',secret);
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

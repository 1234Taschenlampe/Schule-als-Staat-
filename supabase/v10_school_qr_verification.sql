-- SaS ONE | QR-basierte Schulverifizierung, nicht identisch mit E-Mail-Bestätigung.
-- Niemals Name, E-Mail oder Nutzungsrechte in den QR-Code schreiben.
-- Neues Konto ist sofort nutzbar, Lehrkraft/Admin prüft Schüleridentität vor Ort.
alter table public.profiles
  add column if not exists school_verified_at timestamptz,
  add column if not exists school_verified_by uuid references auth.users(id) on delete set null;
create index if not exists profiles_school_verified_at_idx
  on public.profiles(school_verified_at) where school_verified_at is not null;

create table if not exists public.school_verification_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint school_verification_valid_ttl check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create index if not exists school_verification_expires_idx on public.school_verification_challenges(expires_at);
alter table public.school_verification_challenges enable row level security;
revoke all on public.school_verification_challenges from public,anon,authenticated;

create or replace function public.my_school_verification_status()
returns jsonb
language sql stable security definer set search_path=''
as $$
 select jsonb_build_object(
   'verified',p.school_verified_at is not null,
   'verified_at',p.school_verified_at
 ) from public.profiles p where p.id=(select auth.uid());
$$;
revoke all on function public.my_school_verification_status() from public,anon,authenticated;
grant execute on function public.my_school_verification_status() to authenticated;

create or replace function public.create_school_verification_qr()
returns text
language plpgsql volatile security definer set search_path=''
as $$
declare
 v_uid uuid := auth.uid();
 v_token text;
 v_now timestamptz := now();
 v_previous timestamptz;
begin
 if v_uid is null then raise exception 'Bitte zuerst anmelden.'; end if;
 if not exists (select 1 from public.profiles p where p.id=v_uid) then
   raise exception 'Kein Mitgliedsprofil vorhanden.';
 end if;
 if exists (select 1 from public.profiles p where p.id=v_uid and p.school_verified_at is not null) then
   raise exception 'Die Schulidentität ist bereits geprüft.';
 end if;
 -- Fixed lock scope serializes repeated challenges for the same account.
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,104271));
 select c.created_at into v_previous from public.school_verification_challenges c where c.user_id=v_uid;
 if v_previous is not null and v_previous > v_now - interval '20 seconds' then
   raise exception 'Bitte warte kurz, bevor du einen neuen QR-Code erstellst.';
 end if;
 v_token := encode(extensions.gen_random_bytes(32),'hex');
 insert into public.school_verification_challenges(user_id,token_hash,created_at,expires_at)
 values(v_uid,extensions.digest(v_token,'sha256'),v_now,v_now+interval '10 minutes')
 on conflict (user_id) do update
 set token_hash=excluded.token_hash, created_at=excluded.created_at, expires_at=excluded.expires_at;
 return 'SAS-VERIFY:'||v_token;
end;
$$;
revoke all on function public.create_school_verification_qr() from public,anon,authenticated;
grant execute on function public.create_school_verification_qr() to authenticated;

create or replace function public.review_school_verification_qr(p_code text)
returns jsonb
language plpgsql volatile security definer set search_path=''
as $$
declare
 v_token text := lower(btrim(coalesce(p_code,'')));
 v_hash bytea;
 v_name text;
 v_email text;
 v_class text;
 v_id uuid;
 v_time timestamptz;
begin
 if not exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin') then
   raise exception 'Nur autorisierte Schuladministratoren dürfen Codes prüfen.';
 end if;
 if left(v_token,11)='sas-verify:' then v_token:=substr(v_token,12); end if;
 if v_token !~ '^[0-9a-f]{64}$' then raise exception 'Kein gültiger Schul-QR-Code.'; end if;
 v_hash:=extensions.digest(v_token,'sha256');
 select p.id,p.display_name,u.email,coalesce(s.class_label,''),p.school_verified_at
 into v_id,v_name,v_email,v_class,v_time
 from public.school_verification_challenges c
 join public.profiles p on p.id=c.user_id
 join auth.users u on u.id=p.id
 left join public.student_cards s on s.user_id=p.id
 where c.token_hash=v_hash and c.expires_at>now();
 if v_id is null then raise exception 'QR-Code ist abgelaufen, ersetzt oder ungültig.'; end if;
 if v_time is not null then raise exception 'Konto wurde bereits schulisch verifiziert.'; end if;
 return jsonb_build_object('user_id',v_id,'display_name',v_name,'email',v_email,'class_label',v_class);
end;
$$;
revoke all on function public.review_school_verification_qr(text) from public,anon,authenticated;
grant execute on function public.review_school_verification_qr(text) to authenticated;

create or replace function public.confirm_school_verification_qr(p_code text,p_identity_checked boolean)
returns jsonb
language plpgsql volatile security definer set search_path=''
as $$
declare
 v_token text := lower(btrim(coalesce(p_code,'')));
 v_hash bytea;
 v_uid uuid;
 v_name text;
begin
 if not exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin') then
   raise exception 'Keine Schulverifizierungsberechtigung.';
 end if;
 if p_identity_checked is distinct from true then
   raise exception 'Bitte die Identität vor Ort mit den Schulunterlagen abgleichen.';
 end if;
 if left(v_token,11)='sas-verify:' then v_token:=substr(v_token,12); end if;
 if v_token !~ '^[0-9a-f]{64}$' then raise exception 'Ungültiger QR-Code.'; end if;
 v_hash:=extensions.digest(v_token,'sha256');
 select c.user_id into v_uid from public.school_verification_challenges c
 where c.token_hash=v_hash and c.expires_at>now() for update;
 if v_uid is null then raise exception 'QR-Code ist abgelaufen, ersetzt oder bereits verbraucht.'; end if;
 update public.profiles p set school_verified_at=now(),school_verified_by=(select auth.uid())
 where p.id=v_uid and p.school_verified_at is null
 returning p.display_name into v_name;
 if v_name is null then raise exception 'Dieses Konto ist bereits verifiziert.'; end if;
 delete from public.school_verification_challenges where user_id=v_uid;
 -- Do NOT modify admin/cashier roles, wallet money, or voting rights.
 return jsonb_build_object('verified',true,'display_name',v_name,'user_id',v_uid);
end;
$$;
revoke all on function public.confirm_school_verification_qr(text,boolean) from public,anon,authenticated;
grant execute on function public.confirm_school_verification_qr(text,boolean) to authenticated;

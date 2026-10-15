-- Schule als Staat / Neß Vegas V4 — internal virtual currency only.
-- Run in a NEW Supabase project SQL editor. Review before production use.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Mitglied',
  role text not null default 'member' check (role in ('member','cashier','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references public.profiles(id),
  amount_cents integer not null check (amount_cents between 1 and 1000000),
  note text not null default '' check (char_length(note) <= 140),
  status text not null default 'pending' check (status in ('pending','paid')),
  paid_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  paid_at timestamptz,
  constraint paid_consistency check ((status = 'pending' and paid_by is null and paid_at is null) or (status = 'paid' and paid_by is not null and paid_at is not null))
);

create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('payment','credit')),
  payer_id uuid references public.profiles(id),
  payee_id uuid not null references public.profiles(id),
  amount_cents bigint not null check (amount_cents > 0),
  request_id uuid unique references public.payment_requests(id),
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint ledger_kind_valid check ((kind='payment' and payer_id is not null and request_id is not null) or (kind='credit' and payer_id is null and request_id is null))
);

create table if not exists public.cash_sales (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references public.profiles(id),
  amount_cents integer not null check (amount_cents between 1 and 1000000),
  note text not null default '' check (char_length(note) <= 140),
  created_at timestamptz not null default now()
);

create index if not exists payment_requests_cashier_date on public.payment_requests(cashier_id,created_at desc);
create index if not exists wallet_ledger_payer_date on public.wallet_ledger(payer_id,created_at desc);
create index if not exists wallet_ledger_payee_date on public.wallet_ledger(payee_id,created_at desc);
create index if not exists cash_sales_cashier_date on public.cash_sales(cashier_id,created_at desc);

create or replace function public.on_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id,display_name)
    values(new.id, left(coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(coalesce(new.email,''),'@',1), 'Mitglied'), 80))
    on conflict (id) do nothing;
  insert into public.wallets(user_id) values(new.id) on conflict(user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_nevv_new_user on auth.users;
create trigger trg_nevv_new_user after insert on auth.users
  for each row execute procedure public.on_new_user();

-- Allow an existing Auth user population to be upgraded without resetting their accounts.
insert into public.profiles(id,display_name)
  select id,left(coalesce(nullif(raw_user_meta_data->>'full_name',''),split_part(coalesce(email,''),'@',1),'Mitglied'),80) from auth.users
  on conflict(id) do nothing;
insert into public.wallets(user_id)
  select id from public.profiles on conflict(user_id) do nothing;

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.payment_requests enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.cash_sales enable row level security;

revoke all on public.profiles, public.wallets, public.payment_requests, public.wallet_ledger, public.cash_sales from anon, authenticated;
grant select on public.profiles, public.wallets, public.payment_requests, public.wallet_ledger, public.cash_sales to authenticated;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select to authenticated using(id=(select auth.uid()));
drop policy if exists wallets_self on public.wallets;
create policy wallets_self on public.wallets for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists requests_own on public.payment_requests;
create policy requests_own on public.payment_requests for select to authenticated using(cashier_id=(select auth.uid()) or paid_by=(select auth.uid()));
drop policy if exists ledger_participant on public.wallet_ledger;
create policy ledger_participant on public.wallet_ledger for select to authenticated using(payer_id=(select auth.uid()) or payee_id=(select auth.uid()));
drop policy if exists cash_self on public.cash_sales;
create policy cash_self on public.cash_sales for select to authenticated using(cashier_id=(select auth.uid()));

-- Authentication, roles and writes are checked AGAIN on the server.
create or replace function public.create_payment_request(p_amount_cents integer, p_note text default '')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role in ('cashier','admin')) then
    raise exception 'Nur Kassenpersonal darf Zahlungsanforderungen erstellen.';
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 1000000 then
    raise exception 'Ungültiger Betrag.';
  end if;
  insert into public.payment_requests(cashier_id,amount_cents,note)
    values(v_uid,p_amount_cents,left(coalesce(p_note,''),140)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.lookup_payment_request(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_data jsonb;
begin
  if v_uid is null then raise exception 'Anmeldung erforderlich.'; end if;
  select jsonb_build_object(
    'id',r.id,'amount_cents',r.amount_cents,'note',r.note,
    'cashier_name',p.display_name,'expires_at',r.expires_at
  ) into v_data
  from public.payment_requests r join public.profiles p on p.id=r.cashier_id
  where r.id=p_request_id and r.status='pending' and r.expires_at>now() and r.cashier_id<>v_uid;
  if v_data is null then raise exception 'Zahlungsanforderung ungültig, abgelaufen oder bereits bezahlt.'; end if;
  return v_data;
end;
$$;

create or replace function public.settle_payment_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_req public.payment_requests%rowtype; v_balance bigint; v_ledger uuid;
begin
  if v_uid is null then raise exception 'Anmeldung erforderlich.'; end if;
  select * into v_req from public.payment_requests where id=p_request_id for update;
  if not found then raise exception 'Zahlungsanforderung nicht gefunden.'; end if;
  if v_req.status='paid' then
    if v_req.paid_by=v_uid then
      return jsonb_build_object('status','paid','request_id',v_req.id,'already_paid',true);
    end if;
    raise exception 'Zahlungsanforderung bereits bezahlt.';
  end if;
  if v_req.expires_at<=now() then raise exception 'Zahlungsanforderung abgelaufen.'; end if;
  if v_req.cashier_id=v_uid then raise exception 'Eigene Zahlungsanforderungen sind nicht zahlbar.'; end if;

  -- Lock wallets in stable order so simultaneous debits do not overdraw or deadlock.
  perform 1 from public.wallets
    where user_id in (v_uid,v_req.cashier_id) order by user_id for update;
  select balance_cents into v_balance from public.wallets where user_id=v_uid;
  if v_balance is null then raise exception 'Konto nicht gefunden.'; end if;
  if v_balance < v_req.amount_cents then raise exception 'Nicht genügend digitales Guthaben.'; end if;

  update public.wallets set balance_cents=balance_cents-v_req.amount_cents,updated_at=now()
    where user_id=v_uid;
  update public.wallets set balance_cents=balance_cents+v_req.amount_cents,updated_at=now()
    where user_id=v_req.cashier_id;
  if not found then raise exception 'Empfängerkonto nicht gefunden.'; end if;
  update public.payment_requests set status='paid',paid_by=v_uid,paid_at=now()
    where id=v_req.id;
  insert into public.wallet_ledger(kind,payer_id,payee_id,amount_cents,request_id,note)
    values('payment',v_uid,v_req.cashier_id,v_req.amount_cents,v_req.id,v_req.note)
    returning id into v_ledger;
  return jsonb_build_object('status','paid','request_id',v_req.id,'ledger_id',v_ledger,'already_paid',false);
end;
$$;

create or replace function public.record_cash_sale(p_amount_cents integer,p_note text default '')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role in ('cashier','admin')) then
    raise exception 'Nur Kassenpersonal darf Bargeldumsätze buchen.';
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 1000000 then
    raise exception 'Ungültiger Betrag.';
  end if;
  insert into public.cash_sales(cashier_id,amount_cents,note)
    values(v_uid,p_amount_cents,left(coalesce(p_note,''),140)) returning id into v_id;
  return v_id;
end;
$$;

-- Virtual currency issuance is admin-only; no client can mint its own points.
create or replace function public.issue_credits(p_user_id uuid,p_amount_cents integer,p_note text default '')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role='admin') then
    raise exception 'Nur Administratoren können Guthaben ausgeben.';
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 1000000 then
    raise exception 'Ungültiger Betrag.';
  end if;
  update public.wallets set balance_cents=balance_cents+p_amount_cents,updated_at=now()
    where user_id=p_user_id;
  if not found then raise exception 'Zielkonto nicht gefunden.'; end if;
  insert into public.wallet_ledger(kind,payee_id,amount_cents,note)
    values('credit',p_user_id,p_amount_cents,left(coalesce(p_note,''),140))
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_payment_request(integer,text),
  public.lookup_payment_request(uuid), public.settle_payment_request(uuid),
  public.record_cash_sale(integer,text),public.issue_credits(uuid,integer,text)
  from public, anon, authenticated;
grant execute on function public.create_payment_request(integer,text),
  public.lookup_payment_request(uuid), public.settle_payment_request(uuid),
  public.record_cash_sale(integer,text),public.issue_credits(uuid,integer,text)
  to authenticated;
-- No direct UPDATE/INSERT/DELETE grants for app users.


-- Administrator-only directory and role assignment, without broad public table access.
create or replace function public.admin_list_users()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_list jsonb;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id=v_uid and role='admin') then
    raise exception 'Keine Administratorberechtigung.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name,'role',role) order by display_name),'[]'::jsonb)
    into v_list from public.profiles;
  return v_list;
end;
$$;

create or replace function public.admin_set_cashier(p_user_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles where id=v_uid and role='admin') then
    raise exception 'Keine Administratorberechtigung.';
  end if;
  if p_user_id=v_uid then raise exception 'Eigene Rolle nicht ändern.'; end if;
  update public.profiles set role=case when p_enabled then 'cashier' else 'member' end
    where id=p_user_id and role<>'admin';
  if not found then raise exception 'Mitglied nicht gefunden oder Administrator.'; end if;
  return true;
end;
$$;

revoke all on function public.admin_list_users(),public.admin_set_cashier(uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.admin_list_users(),public.admin_set_cashier(uuid,boolean)
  to authenticated;

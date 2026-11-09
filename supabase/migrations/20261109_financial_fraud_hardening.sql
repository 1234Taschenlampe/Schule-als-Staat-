-- SAS fraud hardening: additive controls; existing RPC signatures, UI and roles remain unchanged.
-- No names, passwords, QR secrets, student lists or account credentials are stored here.
-- Baseline records existing balances (including the admin's historical test credit)
-- without representing them as ledger-backed payouts.

create table sas_private.wallet_opening_balances (
  user_id uuid primary key references public.wallets(user_id) on delete cascade,
  opening_cents bigint not null check (opening_cents >= 0),
  captured_at timestamptz not null default now()
);
alter table sas_private.wallet_opening_balances enable row level security;
revoke all on sas_private.wallet_opening_balances from public, anon, authenticated;
insert into sas_private.wallet_opening_balances(user_id, opening_cents)
select user_id, balance_cents from public.wallets;

create or replace function sas_private.sas_capture_wallet_opening()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into sas_private.wallet_opening_balances(user_id, opening_cents)
  values (new.user_id, new.balance_cents)
  on conflict(user_id) do nothing;
  return new;
end
$$;
revoke all on function sas_private.sas_capture_wallet_opening() from public, anon, authenticated;
create trigger sas_capture_wallet_opening
after insert on public.wallets
for each row execute function sas_private.sas_capture_wallet_opening();

-- Dedicated append-only operational audit: pseudonymous account UUIDs only.
-- Original wallet_ledger remains the authoritative financial posting journal.
create table sas_private.financial_audit_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('credit','payment','cash','payment_request')),
  source_id uuid not null,
  actor_id uuid,
  payer_id uuid,
  payee_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique(event_type,source_id)
);
create index sas_financial_audit_recent_idx
on sas_private.financial_audit_events(id desc);
create index sas_financial_audit_actor_idx
on sas_private.financial_audit_events(actor_id,created_at desc);
alter table sas_private.financial_audit_events enable row level security;
revoke all on sas_private.financial_audit_events from public, anon, authenticated;

-- Preserve the audit's timeline if transactions were entered before activation.
insert into sas_private.financial_audit_events
(event_type,source_id,actor_id,payer_id,payee_id,amount_cents,created_at)
select kind,id,case when kind='payment' then payer_id else null end,
       payer_id,payee_id,amount_cents,created_at
from public.wallet_ledger;
insert into sas_private.financial_audit_events
(event_type,source_id,actor_id,payer_id,payee_id,amount_cents,created_at)
select 'cash',id,cashier_id,null,cashier_id,amount_cents,created_at
from public.cash_sales;
insert into sas_private.financial_audit_events
(event_type,source_id,actor_id,payer_id,payee_id,amount_cents,created_at)
select 'payment_request',id,cashier_id,null,cashier_id,amount_cents,created_at
from public.payment_requests;

create or replace function sas_private.sas_record_financial_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name='wallet_ledger' then
    insert into sas_private.financial_audit_events
      (event_type,source_id,actor_id,payer_id,payee_id,amount_cents)
    values (new.kind,new.id,(select auth.uid()),
            new.payer_id,new.payee_id,new.amount_cents);
  elsif tg_table_name='cash_sales' then
    insert into sas_private.financial_audit_events
      (event_type,source_id,actor_id,payer_id,payee_id,amount_cents)
    values ('cash',new.id,new.cashier_id,null,new.cashier_id,new.amount_cents);
  elsif tg_table_name='payment_requests' then
    insert into sas_private.financial_audit_events
      (event_type,source_id,actor_id,payer_id,payee_id,amount_cents)
    values ('payment_request',new.id,new.cashier_id,null,new.cashier_id,new.amount_cents);
  end if;
  return new;
end
$$;
revoke all on function sas_private.sas_record_financial_event() from public, anon, authenticated;
create trigger sas_audit_wallet_ledger
after insert on public.wallet_ledger
for each row execute function sas_private.sas_record_financial_event();
create trigger sas_audit_cash_sales
after insert on public.cash_sales
for each row execute function sas_private.sas_record_financial_event();
create trigger sas_audit_payment_requests
after insert on public.payment_requests
for each row execute function sas_private.sas_record_financial_event();

-- Neither editing nor deleting a posted ledger entry is a valid refund.
-- A future cancellation must be a separate, traceable compensating booking.
create or replace function sas_private.sas_reject_ledger_mutation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'Gebuchte Umsaetze sind unveraenderlich. Korrekturen erfordern Gegenbuchungen.'
    using errcode='42501';
end
$$;
revoke all on function sas_private.sas_reject_ledger_mutation() from public, anon, authenticated;
create trigger sas_wallet_ledger_append_only
before update or delete on public.wallet_ledger
for each row execute function sas_private.sas_reject_ledger_mutation();

-- Reconcile each affected wallet at transaction end: the existing balance
-- must equal its activation baseline plus all credit/payment postings.
-- Deferral is essential: existing issue_credits and settle_payment_request
-- write wallets before the ledger entry in the SAME transaction.
create or replace function sas_private.sas_verify_wallet_balance(p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actual bigint; v_expected numeric;
begin
  if p_user_id is null then return; end if;
  select w.balance_cents,
         b.opening_cents::numeric +
           coalesce(sum(
             (case when l.payee_id=w.user_id then l.amount_cents else 0 end)::numeric
             - (case when l.payer_id=w.user_id then l.amount_cents else 0 end)::numeric
           ),0)
    into v_actual,v_expected
  from public.wallets w
  join sas_private.wallet_opening_balances b on b.user_id=w.user_id
  left join public.wallet_ledger l
    on l.payer_id=w.user_id or l.payee_id=w.user_id
  where w.user_id=p_user_id
  group by w.user_id,w.balance_cents,b.opening_cents;
  if not found then
    raise exception 'Kontobasis fuer den Finanzabgleich fehlt.'
      using errcode='23514';
  end if;
  if v_actual::numeric is distinct from v_expected then
    raise exception 'Kontostand weicht vom Buchungsjournal ab.'
      using errcode='23514';
  end if;
end
$$;
revoke all on function sas_private.sas_verify_wallet_balance(uuid) from public, anon, authenticated;

create or replace function sas_private.sas_verify_financial_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name='wallet_ledger' then
    perform sas_private.sas_verify_wallet_balance(new.payer_id);
    perform sas_private.sas_verify_wallet_balance(new.payee_id);
  else
    perform sas_private.sas_verify_wallet_balance(new.user_id);
  end if;
  return null;
end
$$;
revoke all on function sas_private.sas_verify_financial_change() from public, anon, authenticated;

create constraint trigger sas_verify_wallet_update
after update of balance_cents on public.wallets
deferrable initially deferred
for each row execute function sas_private.sas_verify_financial_change();

create constraint trigger sas_verify_ledger_insert
after insert on public.wallet_ledger
deferrable initially deferred
for each row execute function sas_private.sas_verify_financial_change();

-- Read-only report. A caller needs the database-verified admin role;
-- regular accounts cannot query the private baseline or audit tables.
create or replace function public.admin_financial_integrity_report(p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles
    where id=(select auth.uid()) and role='admin'
  ) then raise exception 'Nur Administration darf die Finanzpruefung sehen.'
    using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Ungueltiges Limit.' using errcode='22023'; end if;

  with flows as (
    select wallet_id,sum(delta_cents) as net_cents from (
      select payee_id as wallet_id, amount_cents::numeric as delta_cents
        from public.wallet_ledger
      union all
      select payer_id as wallet_id, -amount_cents::numeric as delta_cents
        from public.wallet_ledger where payer_id is not null
    ) postings group by wallet_id
  ), balances as (
    select w.user_id,w.balance_cents,
      (b.opening_cents::numeric+coalesce(f.net_cents,0)) as expected_cents
    from public.wallets w
    left join sas_private.wallet_opening_balances b on b.user_id=w.user_id
    left join flows f on f.wallet_id=w.user_id
  ), mismatches as (
    select * from balances
    where expected_cents is null
      or balance_cents::numeric is distinct from expected_cents
  )
  select jsonb_build_object(
    'wallet_count',(select count(*) from public.wallets),
    'total_balance_cents',(select coalesce(sum(balance_cents),0) from public.wallets),
    'opening_balance_cents',(select coalesce(sum(opening_cents),0) from sas_private.wallet_opening_balances),
    'ledger_entries',(select count(*) from public.wallet_ledger),
    'cash_entries',(select count(*) from public.cash_sales),
    'audit_events',(select count(*) from sas_private.financial_audit_events),
    'wallet_audit_coverage_ok',
      (select count(*) from public.wallet_ledger) =
      (select count(*) from sas_private.financial_audit_events
       where event_type in ('credit','payment')),
    'mismatch_count',(select count(*) from mismatches),
    'mismatches',coalesce((
       select jsonb_agg(jsonb_build_object(
         'citizen_id',coalesce(r.short_login_id,r.login_id,'nicht_zugeordnet'),
         'balance_cents',m.balance_cents,
         'expected_cents',m.expected_cents
       )) from (
         select * from mismatches order by user_id limit p_limit
       ) m left join public.school_roster_members r on r.user_id=m.user_id
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;
revoke all on function public.admin_financial_integrity_report(integer) from public,anon;
grant execute on function public.admin_financial_integrity_report(integer) to authenticated;

create or replace function public.admin_financial_recent_events(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles
    where id=(select auth.uid()) and role='admin'
  ) then raise exception 'Nur Administration darf das Finanzprotokoll sehen.'
    using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Ungueltiges Limit.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id',e.id,'type',e.event_type,'record_id',e.source_id,
    'actor',coalesce(a.short_login_id,a.login_id,case when e.actor_id is null then 'System' else 'Admin/Personal' end),
    'payer',coalesce(p.short_login_id,p.login_id),
    'payee',coalesce(t.short_login_id,t.login_id,'Admin/Personal'),
    'amount_cents',e.amount_cents,'created_at',e.created_at
  ) order by e.id desc),'[]'::jsonb) into v_result
  from (
    select * from sas_private.financial_audit_events order by id desc limit p_limit
  ) e
  left join public.school_roster_members a on a.user_id=e.actor_id
  left join public.school_roster_members p on p.user_id=e.payer_id
  left join public.school_roster_members t on t.user_id=e.payee_id;
  return v_result;
end
$$;
revoke all on function public.admin_financial_recent_events(integer) from public,anon;
grant execute on function public.admin_financial_recent_events(integer) to authenticated;

-- Prove activation did not silently inherit a mismatch.
do $$
begin
  if (select count(*) from public.wallets) <>
     (select count(*) from sas_private.wallet_opening_balances) then
    raise exception 'Initialer Wallet-Abgleich fehlgeschlagen.';
  end if;
  if (select count(*) from public.wallet_ledger) <>
     (select count(*) from sas_private.financial_audit_events
        where event_type in ('credit','payment')) then
    raise exception 'Initiale Audit-Vollstaendigkeit fehlgeschlagen.';
  end if;
end
$$;

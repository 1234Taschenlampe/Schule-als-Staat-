-- Admin transaction centre (#56). Apply in staging first; do not deploy to production untested.
-- Requires 20261109_financial_fraud_hardening.sql and the short-login roster migration.
-- Only pseudonymous identifiers are returned. Internal school currency != EUR refunds.

begin;

alter table public.wallet_ledger
  add column if not exists reverse_of_id uuid references public.wallet_ledger(id),
  add column if not exists reversal_operation_id uuid,
  add column if not exists reversed_by_admin uuid references public.profiles(id),
  add column if not exists reversal_reason text;
create unique index if not exists wallet_ledger_reverse_of_unique
  on public.wallet_ledger(reverse_of_id) where reverse_of_id is not null;
create unique index if not exists wallet_ledger_reversal_operation_unique
  on public.wallet_ledger(reversal_operation_id) where reversal_operation_id is not null;
create index if not exists wallet_ledger_created_id_idx
  on public.wallet_ledger(created_at desc,id desc);

alter table public.wallet_ledger drop constraint if exists wallet_ledger_kind_check;
alter table public.wallet_ledger drop constraint if exists ledger_kind_valid;
alter table public.wallet_ledger add constraint wallet_ledger_kind_check
  check(kind in ('payment','credit','reversal'));
alter table public.wallet_ledger add constraint ledger_kind_valid check (
 (kind='payment' and payer_id is not null and request_id is not null
   and reverse_of_id is null and reversal_operation_id is null
   and reversed_by_admin is null and reversal_reason is null)
 or
 (kind='credit' and payer_id is null and request_id is null
   and reverse_of_id is null and reversal_operation_id is null
   and reversed_by_admin is null and reversal_reason is null)
 or
 (kind='reversal' and request_id is null and reverse_of_id is not null
   and reversal_operation_id is not null and reversed_by_admin is not null
   and char_length(btrim(coalesce(reversal_reason,''))) between 8 and 500)
);
alter table sas_private.financial_audit_events
  drop constraint if exists financial_audit_events_event_type_check;
alter table sas_private.financial_audit_events
  add constraint financial_audit_events_event_type_check
  check(event_type in ('credit','payment','reversal','cash','payment_request'));

-- The 09-November deferred reconciliation trigger calls this function. Counterbookings
-- carry the SAME payer/payee as their original but have the opposite arithmetic sign.
create or replace function sas_private.sas_verify_wallet_balance(p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actual bigint; v_expected numeric;
begin
  if p_user_id is null then return; end if;
  select w.balance_cents,
         b.opening_cents::numeric +
           coalesce(sum(
             (case when l.payee_id=w.user_id then l.amount_cents
                   else 0 end)::numeric *
                   (case when l.kind='reversal' then -1 else 1 end)
             -
             (case when l.payer_id=w.user_id then l.amount_cents
                   else 0 end)::numeric *
                   (case when l.kind='reversal' then -1 else 1 end)
           ),0)
    into v_actual,v_expected
  from public.wallets w
  join sas_private.wallet_opening_balances b on b.user_id=w.user_id
  left join public.wallet_ledger l
    on l.payer_id=w.user_id or l.payee_id=w.user_id
  where w.user_id=p_user_id
  group by w.user_id,w.balance_cents,b.opening_cents;
  if not found then
    raise exception 'Kontobasis fuer den Finanzabgleich fehlt.' using errcode='23514';
  end if;
  if v_actual::numeric is distinct from v_expected then
    raise exception 'Kontostand weicht vom Buchungsjournal ab.' using errcode='23514';
  end if;
end
$$;
revoke all on function sas_private.sas_verify_wallet_balance(uuid)
  from public,anon,authenticated;

-- A separate immutable journal entry links to the original. Operation-ID + source-ID
-- unique constraints, advisory lock and row locking protect against retries/races.
create or replace function public.admin_reverse_transaction(
  p_original_ledger_id uuid, p_operation_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_original public.wallet_ledger%rowtype;
  v_existing public.wallet_ledger%rowtype;
  v_new_id uuid;
  v_recipient_balance bigint;
  v_wallet uuid;
  v_count integer:=0;
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  if v_admin is null or not exists(
    select 1 from public.profiles where id=v_admin and role='admin'
  ) then raise exception 'Keine Administratorberechtigung.' using errcode='42501'; end if;
  if p_original_ledger_id is null or p_operation_id is null then
    raise exception 'Buchungskennung und Vorgangskennung sind erforderlich.' using errcode='22023';
  end if;
  if char_length(v_reason) not between 8 and 500 then
    raise exception 'Bitte einen nachvollziehbaren Grund (8 bis 500 Zeichen) eingeben.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,94821));
  select * into v_existing from public.wallet_ledger
    where reversal_operation_id=p_operation_id;
  if found then
    if v_existing.reverse_of_id<>p_original_ledger_id then
      raise exception 'Vorgangskennung bereits anderweitig verwendet.' using errcode='23505';
    end if;
    return jsonb_build_object('ledger_id',v_existing.id,
      'original_ledger_id',p_original_ledger_id,'already_processed',true);
  end if;

  select * into v_original from public.wallet_ledger
    where id=p_original_ledger_id for update;
  if not found then raise exception 'Ursprungsbuchung nicht gefunden.' using errcode='22023'; end if;
  if v_original.kind not in ('credit','payment') then
    raise exception 'Nur Zahlungen und Guthabenausgaben sind rueckbuchbar.' using errcode='22023';
  end if;
  if exists(select 1 from public.wallet_ledger where reverse_of_id=v_original.id) then
    raise exception 'Diese Buchung wurde bereits rueckgebucht.' using errcode='23505';
  end if;
  if v_original.payer_id is not null and v_original.payer_id=v_original.payee_id then
    raise exception 'Ungueltige Eigenzahlung.' using errcode='22023';
  end if;

  -- Both relevant wallets are locked in UUID order to prevent concurrent overspending.
  for v_wallet in select user_id from public.wallets
      where user_id=v_original.payee_id or user_id=v_original.payer_id
      order by user_id for update
  loop v_count:=v_count+1; end loop;
  if v_count <> (case when v_original.payer_id is null then 1 else 2 end) then
    raise exception 'Beteiligtes Wallet nicht vorhanden. Manuelle Pruefung erforderlich.' using errcode='22023';
  end if;
  select balance_cents into v_recipient_balance from public.wallets
    where user_id=v_original.payee_id;
  if v_recipient_balance < v_original.amount_cents then
    raise exception 'Empfaenger hat nicht genug Guthaben. Manuelle Pruefung erforderlich.'
      using errcode='23514';
  end if;

  update public.wallets
    set balance_cents=balance_cents-v_original.amount_cents,updated_at=now()
    where user_id=v_original.payee_id;
  if v_original.payer_id is not null then
    update public.wallets
      set balance_cents=balance_cents+v_original.amount_cents,updated_at=now()
      where user_id=v_original.payer_id;
  end if;
  insert into public.wallet_ledger(
    kind,payer_id,payee_id,amount_cents,request_id,note,
    reverse_of_id,reversal_operation_id,reversed_by_admin,reversal_reason
  ) values(
    'reversal',v_original.payer_id,v_original.payee_id,v_original.amount_cents,
    null,'',v_original.id,p_operation_id,v_admin,v_reason
  ) returning id into v_new_id;
  -- The existing AFTER INSERT audit trigger records admin actor and the reversal event.
  -- The deferred wallet/ledger triggers verify the completed transaction at COMMIT.
  return jsonb_build_object('ledger_id',v_new_id,
    'original_ledger_id',v_original.id,'already_processed',false);
end
$$;
revoke all on function public.admin_reverse_transaction(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.admin_reverse_transaction(uuid,uuid,text)
  to authenticated;

-- Combined list: digital wallet ledger + cash receipts. Cash is read-only here:
-- never debit a wallet to "reverse" a physical cash receipt.
create or replace function public.admin_list_transactions(
  p_offset integer default 0,
  p_limit integer default 40,
  p_query text default '',
  p_kind text default 'all',
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_amount_cents bigint default null
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_admin uuid:=(select auth.uid());v_result jsonb;
begin
  if v_admin is null or not exists (
    select 1 from public.profiles where id=v_admin and role='admin'
  ) then raise exception 'Keine Administratorberechtigung.' using errcode='42501'; end if;
  if p_offset is null or p_offset<0 or p_offset>200000
     or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Ungueltige Seitengroesse.' using errcode='22023';
  end if;
  if p_kind not in ('all','payment','credit','reversal','cash')
    or p_kind is null or char_length(coalesce(p_query,''))>100 then
    raise exception 'Ungueltiger Filter.' using errcode='22023';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'Ungueltiger Zeitraum.' using errcode='22023';
  end if;
  if p_amount_cents is not null and (p_amount_cents<1 or p_amount_cents>1000000) then
    raise exception 'Ungueltiger Betrag.' using errcode='22023';
  end if;

  with movements as (
    select l.id,l.kind,l.payer_id,l.payee_id,l.amount_cents,l.created_at,
      l.note,l.request_id,l.reverse_of_id,l.reversal_reason,
      l.reversed_by_admin,
      (select r.id from public.wallet_ledger r where r.reverse_of_id=l.id) as reversal_id
    from public.wallet_ledger l
    union all
    select c.id,'cash'::text,null::uuid,c.cashier_id,c.amount_cents::bigint,
      c.created_at,c.note,null::uuid,null::uuid,null::text,null::uuid,null::uuid
    from public.cash_sales c
  ), identified as (
    select m.*,
      coalesce(p.short_login_id,p.login_id,'Verwaltung') as payer,
      coalesce(t.short_login_id,t.login_id,'Verwaltung') as payee,
      coalesce(a.short_login_id,a.login_id,'Verwaltung') as admin_actor
    from movements m
    left join public.school_roster_members p on p.user_id=m.payer_id
    left join public.school_roster_members t on t.user_id=m.payee_id
    left join public.school_roster_members a on a.user_id=m.reversed_by_admin
  ), filtered as (
    select i.* from identified i where
      (p_kind='all' or i.kind=p_kind)
      and (p_from is null or i.created_at>=p_from)
      and (p_to is null or i.created_at<p_to)
      and (p_amount_cents is null or i.amount_cents=p_amount_cents)
      and (
        btrim(coalesce(p_query,''))='' or
        i.id::text ilike '%'||btrim(p_query)||'%' or
        i.payer ilike '%'||btrim(p_query)||'%' or
        i.payee ilike '%'||btrim(p_query)||'%' or
        coalesce(i.note,'') ilike '%'||btrim(p_query)||'%' or
        coalesce(i.reverse_of_id::text,'') ilike '%'||btrim(p_query)||'%'
      )
  )
  select jsonb_build_object(
    'total_count',(select count(*) from filtered),
    'digital_booked_cents',(select coalesce(sum(amount_cents),0) from filtered where kind in('payment','credit')),
    'digital_reversed_cents',(select coalesce(sum(amount_cents),0) from filtered where kind='reversal'),
    'cash_recorded_cents',(select coalesce(sum(amount_cents),0) from filtered where kind='cash'),
    'rows',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb)
       from (select id,kind,created_at,amount_cents,note,request_id,
          reverse_of_id,reversal_id,reversal_reason,payer,payee,admin_actor,
          case when kind='cash' then 'bar_erfasst'
               when kind='reversal' then 'gegenbuchung'
               when reversal_id is not null then 'rueckgebucht'
               else 'gebucht' end as status
       from filtered order by created_at desc,id desc
       limit p_limit offset p_offset) x)
  ) into v_result;
  return v_result;
end
$$;
revoke all on function public.admin_list_transactions(integer,integer,text,text,timestamptz,timestamptz,bigint)
  from public,anon,authenticated;
grant execute on function public.admin_list_transactions(integer,integer,text,text,timestamptz,timestamptz,bigint)
  to authenticated;

-- Keep the existing integrity report accurate after reversals (no edits to history).
create or replace function public.admin_financial_integrity_report(p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles where id=(select auth.uid()) and role='admin'
  ) then raise exception 'Nur Administration darf die Finanzpruefung sehen.'
    using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Ungueltiges Limit.' using errcode='22023'; end if;

  with flows as (
    select wallet_id,sum(delta_cents) as net_cents from (
      select payee_id as wallet_id,
        amount_cents::numeric*(case when kind='reversal' then -1 else 1 end) as delta_cents
        from public.wallet_ledger
      union all
      select payer_id as wallet_id,
        -amount_cents::numeric*(case when kind='reversal' then -1 else 1 end) as delta_cents
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
       where event_type in ('credit','payment','reversal')),
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

-- Private audit rows are immutable even for an accidentally overprivileged client.
create trigger sas_financial_audit_append_only
before update or delete on sas_private.financial_audit_events
for each row execute function sas_private.sas_reject_ledger_mutation();

commit;

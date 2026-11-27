begin;

create schema sas_sale_guard;
revoke all on schema sas_sale_guard from public, anon, authenticated;

create table sas_sale_guard.receipts (
  actor_id uuid not null,
  operation text not null check (operation in ('shop_checkout', 'record_cash_sale')),
  request_id uuid not null,
  request_hash bytea not null,
  result jsonb not null,
  primary key (actor_id, operation, request_id)
);

-- Serialize identical requests until commit, then replay the committed result.
create function sas_sale_guard.replay(
  p_actor uuid, p_operation text, p_request_id uuid, p_request_hash bytea
)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  receipt sas_sale_guard.receipts%rowtype;
begin
  if p_request_id is null then
    raise exception 'Buchungsschlüssel fehlt.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_actor::text || ':' || p_operation || ':' || p_request_id::text, 875061));
  select * into receipt from sas_sale_guard.receipts
    where actor_id = p_actor and operation = p_operation and request_id = p_request_id;
  if not found then
    return null;
  end if;
  if receipt.request_hash <> p_request_hash then
    raise exception 'Buchungsschlüssel wurde bereits für andere Angaben verwendet.' using errcode = '22023';
  end if;
  return receipt.result;
end;
$$;
revoke all on function sas_sale_guard.replay(uuid, text, uuid, bytea) from public, anon, authenticated;

create function public.shop_checkout_idempotent(
  p_shop_id uuid, p_items jsonb, p_method text, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  request_hash bytea;
  result jsonb;
begin
  if actor is null or public.shop_can_manage(p_shop_id) is distinct from true then
    raise exception 'Keine Shopberechtigung.' using errcode = '42501';
  end if;
  request_hash := sha256(convert_to(jsonb_build_array(p_shop_id, p_items, p_method)::text, 'UTF8'));
  result := sas_sale_guard.replay(actor, 'shop_checkout', p_request_id, request_hash);
  if result is null then
    result := public.shop_checkout(p_shop_id, p_items, p_method);
    insert into sas_sale_guard.receipts values (actor, 'shop_checkout', p_request_id, request_hash, result);
  end if;
  return result;
end;
$$;

create function public.record_cash_sale_idempotent(
  p_amount_cents integer, p_note text, p_request_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  request_hash bytea;
  result jsonb;
begin
  if actor is null or not exists (
    select 1 from public.profiles where id = actor and role in ('cashier', 'admin')
  ) then
    raise exception 'Nur Kassenpersonal darf Bargeldumsätze buchen.' using errcode = '42501';
  end if;
  request_hash := sha256(convert_to(jsonb_build_array(p_amount_cents, left(coalesce(p_note, ''), 140))::text, 'UTF8'));
  result := sas_sale_guard.replay(actor, 'record_cash_sale', p_request_id, request_hash);
  if result is null then
    result := to_jsonb(public.record_cash_sale(p_amount_cents, p_note));
    insert into sas_sale_guard.receipts values (actor, 'record_cash_sale', p_request_id, request_hash, result);
  end if;
  return (result #>> '{}')::uuid;
end;
$$;

revoke all on function public.shop_checkout_idempotent(uuid, jsonb, text, uuid),
  public.record_cash_sale_idempotent(integer, text, uuid) from public, anon, authenticated;
grant execute on function public.shop_checkout_idempotent(uuid, jsonb, text, uuid),
  public.record_cash_sale_idempotent(integer, text, uuid) to authenticated;

commit;

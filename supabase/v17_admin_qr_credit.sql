-- Admin-only QR-based creation of school currency. A scan identifies a wallet; only explicit confirmation credits it.
create or replace function public.admin_lookup_credit_card(p_code text)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_code text:=lower(btrim(coalesce(p_code,'')));v_result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Nur die Administration darf Guthaben ausgeben.';end if;
 if left(v_code,7)='sas-id:' then v_code:=substr(v_code,8);end if;
 if length(v_code)<12 or length(v_code)>200 then raise exception 'Ungültiger Ausweiscode.';end if;
 select jsonb_build_object('user_id',p.id,'display_name',p.display_name,'class_label',c.class_label,'school_verified',p.school_verified_at is not null)
 into v_result
 from public.student_card_codes sc
 join public.profiles p on p.id=sc.user_id
 left join public.student_cards c on c.user_id=p.id
 where sc.code=v_code;
 if v_result is null then raise exception 'Ausweis nicht gefunden.';end if;
 return v_result;
end;
$$;
revoke all on function public.admin_lookup_credit_card(text) from public,anon,authenticated;
grant execute on function public.admin_lookup_credit_card(text) to authenticated;

create table if not exists public.admin_credit_receipts(
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null unique,
 admin_id uuid not null references auth.users(id),
 recipient_id uuid not null references auth.users(id),
 amount_cents integer not null check(amount_cents between 1 and 1000000),
 ledger_id uuid not null unique references public.wallet_ledger(id),
 created_at timestamptz not null default now()
);
alter table public.admin_credit_receipts enable row level security;
revoke all on public.admin_credit_receipts from public,anon,authenticated;

create or replace function public.admin_credit_scanned_card(p_code text,p_amount_cents integer,p_operation_id uuid,p_note text default '')
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_admin uuid:=auth.uid();v_target uuid;v_receipt public.admin_credit_receipts%rowtype;v_ledger uuid;v_code text:=lower(btrim(coalesce(p_code,'')));v_name text;
begin
 if v_admin is null or not exists(select 1 from public.profiles where id=v_admin and role='admin') then raise exception 'Keine Administratorberechtigung.';end if;
 if p_operation_id is null then raise exception 'Vorgangskennung fehlt.';end if;
 if p_amount_cents is null or p_amount_cents not between 1 and 1000000 then raise exception 'Betrag muss zwischen 0,01 und 10.000,00 liegen.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,9138));
 select * into v_receipt from public.admin_credit_receipts where operation_id=p_operation_id;
 if found then return jsonb_build_object('receipt_id',v_receipt.id,'ledger_id',v_receipt.ledger_id,'already_processed',true);end if;
 if left(v_code,7)='sas-id:' then v_code:=substr(v_code,8);end if;
 select sc.user_id,p.display_name into v_target,v_name from public.student_card_codes sc join public.profiles p on p.id=sc.user_id where sc.code=v_code;
 if v_target is null then raise exception 'Ausweis nicht gefunden.';end if;
 if v_target=v_admin then raise exception 'Keine Eigengutschrift über Ausweisscan.';end if;
 -- Reuse the established atomic wallet credit and ledger function.
 v_ledger:=public.issue_credits(v_target,p_amount_cents,left(coalesce(p_note,''),140));
 insert into public.admin_credit_receipts(operation_id,admin_id,recipient_id,amount_cents,ledger_id)
 values(p_operation_id,v_admin,v_target,p_amount_cents,v_ledger) returning * into v_receipt;
 return jsonb_build_object('receipt_id',v_receipt.id,'ledger_id',v_ledger,'recipient',v_name,'amount_cents',p_amount_cents,'already_processed',false);
end;
$$;
revoke all on function public.admin_credit_scanned_card(text,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_credit_scanned_card(text,integer,uuid,text) to authenticated;

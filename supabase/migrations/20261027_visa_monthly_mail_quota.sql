-- Keep the free transactional email quota local to each Berlin calendar month.
-- Preserve all queued emails and existing 100/day dispatch limit.
alter table public.guest_visa_mail_quota
 add column if not exists quota_month date not null
 default date_trunc('month',now() at time zone 'Europe/Berlin')::date;

do $block$
begin
 if exists (select 1 from information_schema.columns
   where table_schema='public' and table_name='guest_visa_mail_quota' and column_name='lifetime_limit')
 and not exists (select 1 from information_schema.columns
   where table_schema='public' and table_name='guest_visa_mail_quota' and column_name='monthly_limit')
 then
  alter table public.guest_visa_mail_quota rename column lifetime_limit to monthly_limit;
 end if;
end $block$;

-- Existing monthly emails count toward the new cap; no records are deleted.
update public.guest_visa_mail_quota
set quota_month=date_trunc('month',now() at time zone 'Europe/Berlin')::date,
 queued_total=(select count(*)::integer from public.guest_visa_mail_outbox
  where created_at>=date_trunc('month',now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')
where singleton=true;

create or replace function public.guest_visa_reserve_mail_quota()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
 v_month date:=date_trunc('month',now() at time zone 'Europe/Berlin')::date;
 v_count integer;
 v_limit integer;
begin
 -- Updating the singleton row takes a row lock; concurrent applicants cannot skip caps.
 update public.guest_visa_mail_quota
 set quota_month=v_month,queued_total=0
 where singleton=true and quota_month<>v_month;
 select queued_total,monthly_limit into v_count,v_limit
 from public.guest_visa_mail_quota where singleton=true for update;
 if not found or v_count>=v_limit then
  raise exception 'ViSA-Verifizierung: Monatskontingent erschöpft.';
 end if;
 update public.guest_visa_mail_quota
 set queued_total=queued_total+1 where singleton=true;
 return new;
end;
$function$;
revoke all on function public.guest_visa_reserve_mail_quota() from public,anon,authenticated;
comment on column public.guest_visa_mail_quota.queued_total
 is 'ViSA verification emails queued in the current quota_month, not lifetime total';

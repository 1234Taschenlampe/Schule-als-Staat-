-- Hard quotas for public ViSA mail: at most 3,000 queued messages total.
-- Conservative default: at most 100 dispatch attempts per day; increase only
-- after the chosen mail provider explicitly permits higher volume.
create table if not exists public.guest_visa_mail_quota(
 singleton boolean primary key default true check(singleton),
 lifetime_limit integer not null default 3000 check(lifetime_limit between 1 and 3000),
 daily_dispatch_limit integer not null default 100 check(daily_dispatch_limit between 1 and 2000),
 queued_total integer not null default 0 check(queued_total>=0),
 claim_day date not null default (now() at time zone 'Europe/Berlin')::date,
 claimed_today integer not null default 0 check(claimed_today>=0)
);
insert into public.guest_visa_mail_quota(singleton) values(true) on conflict(singleton) do nothing;
alter table public.guest_visa_mail_quota enable row level security;
revoke all on public.guest_visa_mail_quota from public,anon,authenticated;

create or replace function public.guest_visa_reserve_mail_quota()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_total integer;v_limit integer;
begin
 select queued_total,lifetime_limit into v_total,v_limit
 from public.guest_visa_mail_quota where singleton for update;
 if not found or v_total>=v_limit then
  raise exception 'ViSA-Verifizierung: Gesamtkontingent erschöpft.';
 end if;
 update public.guest_visa_mail_quota
 set queued_total=queued_total+1 where singleton;
 return new;
end;
$$;
revoke all on function public.guest_visa_reserve_mail_quota() from public,anon,authenticated;
drop trigger if exists guest_visa_mail_quota_guard on public.guest_visa_mail_outbox;
create trigger guest_visa_mail_quota_guard before insert on public.guest_visa_mail_outbox
for each row execute function public.guest_visa_reserve_mail_quota();

create or replace function public.visa_mail_claim(p_limit integer default 10)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_mail jsonb:='[]'::jsonb;
 v_today date:=(now() at time zone 'Europe/Berlin')::date;
 v_available int;v_dispatch int;
begin
 update public.guest_visa_mail_quota
 set claim_day=v_today,claimed_today=0
 where singleton and claim_day<>v_today;
 select greatest(0,daily_dispatch_limit-claimed_today)
 into v_available from public.guest_visa_mail_quota where singleton for update;
 if v_available is null or v_available=0 then return '[]'::jsonb;end if;
 v_dispatch:=least(v_available,least(greatest(coalesce(p_limit,10),1),20));
 with todo as (
  select id from public.guest_visa_mail_outbox
  where (status='queued' or (status='leased' and leased_at<now()-interval '15 minutes'))
  and available_at<=now() and attempt_count<10
  order by created_at for update skip locked limit v_dispatch
 ), claimed as (
  update public.guest_visa_mail_outbox m
  set status='leased',leased_at=now(),attempt_count=m.attempt_count+1
  from todo where m.id=todo.id
  returning m.id,m.recipient,m.verify_token,m.attempt_count
 )
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',id,'recipient',recipient,'token',verify_token,'attempt',attempt_count)),'[]'::jsonb)
 into v_mail from claimed;
 update public.guest_visa_mail_quota
 set claimed_today=claimed_today+jsonb_array_length(v_mail) where singleton;
 return v_mail;
end;
$$;
revoke all on function public.visa_mail_claim(integer) from public,anon,authenticated;
grant execute on function public.visa_mail_claim(integer) to service_role;

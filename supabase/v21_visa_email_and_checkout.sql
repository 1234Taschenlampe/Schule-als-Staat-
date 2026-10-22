-- ViSA guest flow: anonymous request -> independently verified e-mail -> external EUR payment -> admin review.
-- Live email and real-money checkout remain OFF until sender, merchant and fee are configured.
alter table public.guest_visa_applications
 add column if not exists email_verified_at timestamptz,
 add column if not exists paid_at timestamptz,
 add column if not exists amount_cents integer,
 add column if not exists stripe_checkout_session_id text,
 add column if not exists stripe_payment_intent_id text,
 add column if not exists updated_at timestamptz not null default now();
alter table public.guest_visa_applications drop constraint if exists guest_visa_applications_status_check;
alter table public.guest_visa_applications add constraint guest_visa_applications_status_check
 check(status in ('pending_email','email_verified','awaiting_payment','paid','approved','rejected','refunded','submitted'));
alter table public.guest_visa_applications alter column status set default 'pending_email';
create unique index if not exists guest_visa_checkout_unique_idx on public.guest_visa_applications(stripe_checkout_session_id)
 where stripe_checkout_session_id is not null;
create unique index if not exists guest_visa_intent_unique_idx on public.guest_visa_applications(stripe_payment_intent_id)
 where stripe_payment_intent_id is not null;

create table if not exists public.guest_visa_payment_settings (
 singleton boolean primary key default true check(singleton),
 price_cents integer not null default 0 check(price_cents between 0 and 1000000),
 payment_enabled boolean not null default false,
 email_enabled boolean not null default false,
 currency text not null default 'eur' check(currency='eur'),
 changed_at timestamptz not null default now(),
 check(not payment_enabled or (price_cents>0 and email_enabled))
);
insert into public.guest_visa_payment_settings(singleton) values(true) on conflict(singleton) do nothing;
alter table public.guest_visa_payment_settings enable row level security;
revoke all on public.guest_visa_payment_settings from public,anon,authenticated;

create table if not exists public.guest_visa_verification_tokens (
 application_id uuid primary key references public.guest_visa_applications(id) on delete cascade,
 token_hash text unique not null,
 expires_at timestamptz not null,
 verified_at timestamptz,
 issued_at timestamptz not null default now()
);
alter table public.guest_visa_verification_tokens enable row level security;
revoke all on public.guest_visa_verification_tokens from public,anon,authenticated;

create table if not exists public.guest_visa_mail_outbox (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.guest_visa_applications(id) on delete cascade,
 recipient text not null,
 verify_token text not null,
 status text not null default 'queued' check(status in ('queued','leased','sent','failed')),
 attempt_count integer not null default 0 check(attempt_count between 0 and 15),
 available_at timestamptz not null default now(),
 leased_at timestamptz,
 sent_at timestamptz,
 last_error text not null default '',
 created_at timestamptz not null default now()
);
create index if not exists guest_visa_mail_pending on public.guest_visa_mail_outbox(status,available_at);
alter table public.guest_visa_mail_outbox enable row level security;
revoke all on public.guest_visa_mail_outbox from public,anon,authenticated;

create table if not exists public.guest_visa_stripe_events(
 event_id text primary key,
 session_id text not null,
 received_at timestamptz not null default now()
);
alter table public.guest_visa_stripe_events enable row level security;
revoke all on public.guest_visa_stripe_events from public,anon,authenticated;

create or replace function public.visa_public_settings()
returns jsonb language sql stable security definer set search_path=''
as $$
 select jsonb_build_object('email_enabled',email_enabled,'payment_enabled',payment_enabled,
 'price_cents',case when payment_enabled then price_cents else null end,'currency','eur')
 from public.guest_visa_payment_settings where singleton=true;
$$;
revoke all on function public.visa_public_settings() from public,anon,authenticated;
grant execute on function public.visa_public_settings() to anon,authenticated;

create or replace function public.submit_guest_visa(
 p_first_name text,p_last_name text,p_origin_country text,p_planned_entry date,
 p_contact_email text,p_school_class text,p_privacy_accepted boolean,p_website text default ''
) returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_email text:=lower(btrim(coalesce(p_contact_email,'')));
 v_id uuid;v_token text;v_hash text;
begin
 if not (select email_enabled from public.guest_visa_payment_settings where singleton) then
  raise exception 'Die E-Mail-Verifizierung ist noch nicht freigeschaltet.';
 end if;
 if coalesce(p_website,'')<>'' then raise exception 'Anfrage nicht angenommen.';end if;
 if p_privacy_accepted is distinct from true then raise exception 'Datenschutzbestätigung fehlt.';end if;
 if char_length(btrim(coalesce(p_first_name,''))) not between 1 and 80
 or char_length(btrim(coalesce(p_last_name,''))) not between 1 and 80
 or char_length(btrim(coalesce(p_origin_country,''))) not between 2 and 80
 or char_length(btrim(coalesce(p_school_class,'')))>60
 or char_length(v_email) not between 5 and 200
 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
 or p_planned_entry is null or p_planned_entry < current_date
 or p_planned_entry > current_date+interval '2 years'
 then raise exception 'Bitte die Angaben prüfen.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_email,1937));
 if (select count(*) from public.guest_visa_applications where contact_email=v_email and submitted_at>now()-interval '1 day')>=3
 then raise exception 'Anfragelimit erreicht. Bitte morgen erneut versuchen.';end if;
 if exists(select 1 from public.guest_visa_applications where contact_email=v_email and submitted_at>now()-interval '15 minutes')
 then raise exception 'Bitte vor einem weiteren Antrag 15 Minuten warten.';end if;
 insert into public.guest_visa_applications(first_name,last_name,origin_country,planned_entry,contact_email,school_class,privacy_accepted,status)
 values(btrim(p_first_name),btrim(p_last_name),btrim(p_origin_country),p_planned_entry,v_email,btrim(coalesce(p_school_class,'')),true,'pending_email')
 returning id into v_id;
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 v_hash:=encode(extensions.digest(v_token,'sha256'),'hex');
 insert into public.guest_visa_verification_tokens(application_id,token_hash,expires_at)
 values(v_id,v_hash,now()+interval '7 days');
 insert into public.guest_visa_mail_outbox(application_id,recipient,verify_token)
 values(v_id,v_email,v_token);
 return jsonb_build_object('queued',true,'message','Anfrage angenommen. Bitte den Link aus der E-Mail bestätigen.');
end;
$$;
revoke all on function public.submit_guest_visa(text,text,text,date,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.submit_guest_visa(text,text,text,date,text,text,boolean,text) to anon,authenticated;

create or replace function public.verify_guest_visa_email(p_token text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare v_id uuid;v_expires timestamptz;v_verified timestamptz;v_status text;v_payment_enabled boolean;v_price int;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Ungültiger Bestätigungslink.';end if;
 select t.application_id,t.expires_at,t.verified_at into v_id,v_expires,v_verified
 from public.guest_visa_verification_tokens t
 where t.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
 if v_id is null or v_expires<now() then raise exception 'Bestätigungslink ungültig oder abgelaufen.';end if;
 if v_verified is null then
  update public.guest_visa_verification_tokens set verified_at=now() where application_id=v_id;
  update public.guest_visa_applications
   set email_verified_at=now(),status='email_verified',updated_at=now()
   where id=v_id and status='pending_email';
 end if;
 select status into v_status from public.guest_visa_applications where id=v_id;
 select payment_enabled,price_cents into v_payment_enabled,v_price from public.guest_visa_payment_settings where singleton;
 return jsonb_build_object('verified',true,'payment_enabled',v_payment_enabled,
 'price_cents',case when v_payment_enabled then v_price else null end,
 'status',v_status);
end;
$$;
revoke all on function public.verify_guest_visa_email(text) from public,anon,authenticated;
grant execute on function public.verify_guest_visa_email(text) to anon,authenticated;

-- Only the backend service role may obtain an email-verified checkout order.
create or replace function public.visa_checkout_context(p_token text)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v jsonb;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Ungültiger Vorgang.';end if;
 select jsonb_build_object('id',a.id,'email',a.contact_email,
 'amount_cents',s.price_cents,'currency',s.currency,
 'session_id',a.stripe_checkout_session_id)
 into v
 from public.guest_visa_verification_tokens t
 join public.guest_visa_applications a on a.id=t.application_id
 cross join public.guest_visa_payment_settings s
 where t.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
 and t.verified_at is not null and t.expires_at>now()
 and a.email_verified_at is not null and a.status in ('email_verified','awaiting_payment')
 and s.singleton and s.payment_enabled and s.email_enabled and s.price_cents>0;
 if v is null then raise exception 'Zahlung aktuell nicht verfügbar oder E-Mail nicht bestätigt.';end if;
 return v;
end;
$$;
revoke all on function public.visa_checkout_context(text) from public,anon,authenticated;
grant execute on function public.visa_checkout_context(text) to service_role;

create or replace function public.visa_store_checkout(p_token text,p_session text,p_amount_cents integer)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_id uuid;v_amount integer;
begin
 if p_session is null or p_session !~ '^cs_(test|live)_' then raise exception 'Ungültige Checkout-Sitzung.';end if;
 select a.id,s.price_cents into v_id,v_amount
 from public.guest_visa_verification_tokens t
 join public.guest_visa_applications a on a.id=t.application_id
 cross join public.guest_visa_payment_settings s
 where t.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
 and t.verified_at is not null and t.expires_at>now()
 and a.status in ('email_verified','awaiting_payment')
 and s.singleton and s.payment_enabled and s.price_cents>0;
 if v_id is null or p_amount_cents<>v_amount then raise exception 'Ungültige oder geänderte Bezahlung.';end if;
 update public.guest_visa_applications
 set stripe_checkout_session_id=p_session,amount_cents=v_amount,status='awaiting_payment',updated_at=now()
 where id=v_id and stripe_checkout_session_id is null;
 if not found then raise exception 'Es besteht bereits eine Checkout-Sitzung.';end if;
 return true;
end;
$$;
revoke all on function public.visa_store_checkout(text,text,integer) from public,anon,authenticated;
grant execute on function public.visa_store_checkout(text,text,integer) to service_role;

create or replace function public.visa_confirm_checkout(
 p_session text,p_payment_intent text,p_amount_cents bigint,p_currency text,p_event_id text
) returns boolean language plpgsql security definer set search_path=''
as $$
declare v_id uuid;v_expected integer;v_status text;
begin
 if p_session is null or p_payment_intent is null or p_event_id is null or
 p_currency<>'eur' or p_amount_cents is null or p_amount_cents<1 then
 raise exception 'Ungültige Zahlungsbestätigung.';end if;
 select id,amount_cents,status into v_id,v_expected,v_status
 from public.guest_visa_applications
 where stripe_checkout_session_id=p_session for update;
 if v_id is null or v_expected is null or v_expected::bigint<>p_amount_cents then
 raise exception 'Zahlungsbetrag oder Vorgangsnummer stimmen nicht überein.';end if;
 if v_status in ('paid','approved') then
  return true;
 end if;
 if v_status<>'awaiting_payment' then raise exception 'Zahlung nicht im erwarteten Zustand.';end if;
 insert into public.guest_visa_stripe_events(event_id,session_id) values(p_event_id,p_session)
 on conflict(event_id) do nothing;
 update public.guest_visa_applications
 set status='paid',paid_at=now(),stripe_payment_intent_id=p_payment_intent,updated_at=now()
 where id=v_id;
 return true;
end;
$$;
revoke all on function public.visa_confirm_checkout(text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.visa_confirm_checkout(text,text,bigint,text,text) to service_role;

-- An isolated mail worker calls the restricted Edge Function, never a public Data API.
create or replace function public.visa_mail_claim(p_limit integer default 10)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare v_mail jsonb;
begin
 with todo as (
  select id from public.guest_visa_mail_outbox
  where (status='queued' or (status='leased' and leased_at<now()-interval '15 minutes'))
  and available_at<=now() and attempt_count<10
  order by created_at for update skip locked limit least(greatest(coalesce(p_limit,10),1),20)
 ), claimed as (
  update public.guest_visa_mail_outbox m
  set status='leased',leased_at=now(),attempt_count=m.attempt_count+1
  from todo where m.id=todo.id
  returning m.id,m.recipient,m.verify_token,m.attempt_count
 )
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',id,'recipient',recipient,'token',verify_token,'attempt',attempt_count)),'[]'::jsonb)
 into v_mail from claimed;
 return v_mail;
end;
$$;
revoke all on function public.visa_mail_claim(integer) from public,anon,authenticated;
grant execute on function public.visa_mail_claim(integer) to service_role;

create or replace function public.visa_mail_ack(p_id uuid,p_success boolean,p_error text default '')
returns boolean language plpgsql volatile security definer set search_path=''
as $$
begin
 update public.guest_visa_mail_outbox
 set status=case when p_success then 'sent' when attempt_count>=10 then 'failed' else 'queued' end,
     sent_at=case when p_success then now() else null end,
     verify_token=case when p_success then '' else verify_token end,
     last_error=left(coalesce(p_error,''),240),
     available_at=case when p_success then now() else now()+make_interval(mins=>least(60,power(2,least(attempt_count,6))::integer)) end,
     leased_at=null
 where id=p_id and status='leased';
 return found;
end;
$$;
revoke all on function public.visa_mail_ack(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.visa_mail_ack(uuid,boolean,text) to service_role;

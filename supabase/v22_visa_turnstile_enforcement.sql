-- Anonymous clients cannot bypass server-side Turnstile by calling the old SQL RPC.
-- The only entry point for new guest applications is the rate-limited visa-request Edge Function.
revoke execute on function public.submit_guest_visa(text,text,text,date,text,text,boolean,text)
 from public,anon,authenticated;
grant execute on function public.submit_guest_visa(text,text,text,date,text,text,boolean,text) to service_role;
alter table public.guest_visa_payment_settings add column if not exists turnstile_site_key text;
create or replace function public.visa_public_settings()
returns jsonb language sql stable security definer set search_path=''
as $$
 select jsonb_build_object('email_enabled',email_enabled,
 'payment_enabled',payment_enabled,
 'turnstile_site_key',turnstile_site_key,
 'price_cents',case when payment_enabled then price_cents else null end,'currency','eur')
 from public.guest_visa_payment_settings where singleton=true;
$$;
revoke all on function public.visa_public_settings() from public,anon,authenticated;
grant execute on function public.visa_public_settings() to anon,authenticated;

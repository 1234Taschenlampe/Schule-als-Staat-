-- Free Cloudflare Turnstile credential remains encrypted in Supabase Vault.
-- Only the server-side service_role account can access this function.
create or replace function public.visa_turnstile_siteverify_secret()
returns text language sql stable security definer set search_path=''
as $$
 select decrypted_secret from vault.decrypted_secrets
 where name='sas_visa_turnstile_secret' limit 1;
$$;
revoke all on function public.visa_turnstile_siteverify_secret() from public,anon,authenticated;
grant execute on function public.visa_turnstile_siteverify_secret() to service_role;

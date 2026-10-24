-- A server-generated Vault token authenticates Supabase pg_cron to the Gmail dispatcher.
-- The existing Edge Function Secrets are preserved, not read or rotated.
-- No public or authenticated client can invoke this verifier.
create or replace function public.visa_gmail_vault_authorize(p_token text)
returns boolean language sql stable security definer set search_path = ''
as $$
 select coalesce(
   p_token ~ '^[0-9a-f]{64}$'
   and exists (
     select 1 from vault.decrypted_secrets v
     where v.name = 'visa_gmail_dispatch_secret'
       and encode(extensions.digest(v.decrypted_secret, 'sha256'), 'hex') =
           encode(extensions.digest(p_token, 'sha256'), 'hex')
   ), false
 );
$$;
revoke all on function public.visa_gmail_vault_authorize(text) from public, anon, authenticated;
grant execute on function public.visa_gmail_vault_authorize(text) to service_role;

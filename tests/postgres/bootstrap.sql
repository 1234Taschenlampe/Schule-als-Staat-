-- Minimal stand-ins for the Supabase platform in a disposable PostgreSQL instance.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema extensions;
create extension pgcrypto schema extensions;
create schema vault;
create table vault.decrypted_secrets(name text, decrypted_secret text);
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}',
 raw_app_meta_data jsonb default '{}', encrypted_password text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
grant usage on schema auth to anon, authenticated;
-- Model the permissive legacy Data API defaults as an additional regression case.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

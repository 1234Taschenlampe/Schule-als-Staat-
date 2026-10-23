-- Security audit 2026-10-23: remove SQL-level destructive/DDL grants
-- from public-facing roles. Ordinary REST operations do not need these grants.
-- Important: TRUNCATE is NOT constrained by RLS.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- Legacy citizen-only ViSA application creation bypassed the new public
-- email verification + EUR payment flow. Keep old records accessible to admins,
-- but stop new requests through the deprecated direct INSERT route.
revoke insert on table public.visa_applications from anon, authenticated;
drop policy if exists sas_visa_submit on public.visa_applications;

-- Avoid reintroducing this class of privilege in newly created tables.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

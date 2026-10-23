-- Security audit 2026-10-23: remove SQL-level destructive/DDL grants
-- from public-facing roles. Ordinary REST operations do not need these grants.
-- Important: TRUNCATE is NOT constrained by RLS.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- Legacy citizen-only ViSA application creation bypassed the new public
-- email verification + EUR payment flow. Keep old records accessible to admins,
-- but stop new requests through the deprecated direct INSERT route.
revoke insert on table public.visa_applications from anon, authenticated;
drop policy if exists sas_visa_submit on public.visa_applications;

-- Future-table default privilege tightening needs a schema owner/admin role
-- and is intentionally not changed by this migration. Revoke dangerous
-- grants explicitly on each newly created table in future migrations.

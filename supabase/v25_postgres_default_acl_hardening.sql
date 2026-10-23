-- Follow-up to security_acl_hardening_v24.
-- The postgres-owned default ACL for NEW public tables granted TRUNCATE,
-- REFERENCES and TRIGGER to browser-facing roles. Revoke those privileges.
-- Keep ordinary SELECT/INSERT/UPDATE/DELETE defaults unchanged.
-- supabase_admin-owned defaults are managed by Supabase and are not modified here.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

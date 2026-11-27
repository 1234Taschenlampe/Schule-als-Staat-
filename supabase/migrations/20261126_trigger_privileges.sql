-- Trigger invocation does not require an EXECUTE grant to the calling browser role.
revoke all on function public.guard_verified_school_card_identity(), public.on_new_user()
 from public, anon, authenticated;
-- Remove schema-specific grants left by earlier Supabase installations.
-- New public tables require an explicit client-facing grant in their migration.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

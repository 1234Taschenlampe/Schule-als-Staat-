-- Read-only catalog audit. Run as an authorized database auditor.
-- No student data, credentials, function bodies or business records are selected.
begin transaction read only;
set local statement_timeout = '15s';

-- Application tables with RLS status and effective API-role access.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') as anon_any_write,
       has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') as authenticated_any_write
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
order by c.relrowsecurity, c.relname;

-- Policies: names and scope only; review predicates separately.
select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies where schemaname='public' order by tablename,policyname;

-- Privileged routines reachable by API roles; manual review required.
select n.nspname as schema_name, p.proname as routine_name,
       pg_get_function_identity_arguments(p.oid) as signature,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) s where s like 'search_path=%') as explicit_search_path
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
order by anon_execute desc, authenticated_execute desc, routine_name, signature;

rollback;

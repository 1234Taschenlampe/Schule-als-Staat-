-- Applied in production: school_directory_privacy_and_throttling_v32 (2026-10-27)
-- Protect students from operator enumeration; existing data stays unchanged.
create schema if not exists sas_private;
revoke all on schema sas_private from public, anon, authenticated;
create table if not exists sas_private.directory_search_budget (
 user_id uuid primary key references auth.users(id) on delete cascade,
 burst_started_at timestamptz not null,
 burst_count integer not null,
 day_started_at timestamptz not null,
 day_count integer not null
);
alter table sas_private.directory_search_budget enable row level security;
revoke all on table sas_private.directory_search_budget from public, anon, authenticated;
CREATE OR REPLACE FUNCTION public.school_role_find_students(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_query text := btrim(coalesce(p_query,''));
  v_is_admin boolean;
  v_now timestamptz := clock_timestamp();
  v_burst integer;
  v_daily integer;
  v_data jsonb;
begin
  if v_uid is null or not public.sas_can_manage_school() then
    raise exception 'Keine Rollenverwaltungsberechtigung.';
  end if;

  -- No SQL LIKE wildcards, escape characters or trivially broad terms.
  if char_length(v_query) < 4 or char_length(v_query) > 80
     or position('%' in v_query) > 0
     or position('_' in v_query) > 0
     or position(chr(92) in v_query) > 0 then
    raise exception 'Bitte mindestens vier Zeichen ohne Platzhalter eingeben.';
  end if;

  select exists (
    select 1 from public.profiles p where p.id = v_uid and p.role = 'admin'
  ) into v_is_admin;

  -- Operators can manage ordinary school roles, but cannot bulk harvest
  -- student e-mail addresses. Enforce quota in Postgres (all clients/routes).
  if not v_is_admin then
    insert into sas_private.directory_search_budget
      (user_id, burst_started_at, burst_count, day_started_at, day_count)
    values (v_uid, v_now, 1, v_now, 1)
    on conflict (user_id) do update set
      burst_started_at = case
        when sas_private.directory_search_budget.burst_started_at <= v_now - interval '10 minutes'
        then v_now else sas_private.directory_search_budget.burst_started_at end,
      burst_count = case
        when sas_private.directory_search_budget.burst_started_at <= v_now - interval '10 minutes'
        then 1 else sas_private.directory_search_budget.burst_count + 1 end,
      day_started_at = case
        when sas_private.directory_search_budget.day_started_at <= v_now - interval '24 hours'
        then v_now else sas_private.directory_search_budget.day_started_at end,
      day_count = case
        when sas_private.directory_search_budget.day_started_at <= v_now - interval '24 hours'
        then 1 else sas_private.directory_search_budget.day_count + 1 end
    returning burst_count, day_count into v_burst, v_daily;

    if v_burst > 20 or v_daily > 60 then
      raise exception 'Suchlimit erreicht. Bitte später erneut versuchen.';
    end if;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', matches.id,
      'name', matches.display_name,
      'email', case when v_is_admin then matches.email else null end,
      'system_role', matches.role,
      'verified', matches.school_verified_at is not null,
      'jobs', coalesce((
        select jsonb_agg(a.role_slug order by a.role_slug)
        from public.school_role_assignments a where a.user_id = matches.id
      ), '[]'::jsonb)
    ) order by matches.display_name
  ), '[]'::jsonb) into v_data
  from (
    select p.id, p.display_name, p.role, p.school_verified_at,
      case when v_is_admin then u.email else null end as email
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.display_name ilike '%' || v_query || '%'
      or (v_is_admin and u.email ilike '%' || v_query || '%')
    order by p.display_name
    limit 10
  ) matches;

  return v_data;
end;
$function$;
revoke all on function public.school_role_find_students(text) from public, anon, authenticated;
grant execute on function public.school_role_find_students(text) to authenticated;
comment on function public.school_role_find_students(text) is
 'Role-gated directory search: wildcard rejected, max 10, operator email redacted, operator per-user quotas in private table.';

-- Restore the existing operator directory-search quota for the new exact-ID lookup.
create or replace function public.school_role_find_by_login_id(p_query text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  uid uuid:=auth.uid();
  phrase text:=upper(btrim(coalesce(p_query,'')));
  is_admin boolean;
  current_time timestamptz:=clock_timestamp();
  current_burst integer;
  current_daily integer;
begin
  if uid is null or not public.sas_can_manage_school() then
    raise exception 'Keine Rollenverwaltungsberechtigung.';end if;
  if phrase !~ '^(SAS-[0-9]{6}|SAS-[A-Z2-9]{10})$' then
    raise exception 'Bitte die vollständige Bürgerkennung eingeben.';end if;
  select exists(select 1 from public.profiles p where p.id=uid and p.role='admin') into is_admin;
  if not is_admin then
    insert into sas_private.directory_search_budget as budget
      (user_id,burst_started_at,burst_count,day_started_at,day_count)
    values(uid,current_time,1,current_time,1)
    on conflict (user_id) do update set
      burst_started_at=case when budget.burst_started_at<=current_time-interval '10 minutes'
        then current_time else budget.burst_started_at end,
      burst_count=case when budget.burst_started_at<=current_time-interval '10 minutes'
        then 1 else budget.burst_count+1 end,
      day_started_at=case when budget.day_started_at<=current_time-interval '24 hours'
        then current_time else budget.day_started_at end,
      day_count=case when budget.day_started_at<=current_time-interval '24 hours'
        then 1 else budget.day_count+1 end
    returning burst_count,day_count into current_burst,current_daily;
    if current_burst>20 or current_daily>60 then
      raise exception 'Suchlimit erreicht. Bitte später erneut versuchen.';end if;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,'login_id',coalesce(r.short_login_id,r.login_id),
      'system_role',p.role,'verified',p.school_verified_at is not null,
      'jobs',coalesce((select jsonb_agg(a.role_slug order by a.role_slug)
        from public.school_role_assignments a where a.user_id=p.id),'[]'::jsonb)
    )),'[]'::jsonb)
    from public.school_roster_members r join public.profiles p on p.id=r.user_id
    where r.active and (r.login_id=phrase or r.short_login_id=phrase)
  );
end
$$;
revoke all on function public.school_role_find_by_login_id(text) from public,anon;
grant execute on function public.school_role_find_by_login_id(text) to authenticated;

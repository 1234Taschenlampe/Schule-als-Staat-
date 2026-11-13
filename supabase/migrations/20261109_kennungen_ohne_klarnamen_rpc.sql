
-- Read/write facades for the pseudonymous SAS interface.
-- Existing encrypted names, account records, balances and QR tokens remain unchanged.
-- The older RPC signatures remain available for legacy callers until a separate
-- compatibility/privacy review; the new frontend exclusively calls these facades.

create or replace function public.admin_list_user_ids()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'
  ) then raise exception 'Keine Administratorberechtigung.'; end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id, 'login_id',r.login_id, 'role',p.role,
      'vote_eligible',p.vote_eligible
    ) order by r.login_id nulls last),'[]'::jsonb)
    from public.profiles p
    left join public.school_roster_members r on r.user_id=p.id
  );
end
$$;

create or replace function public.school_role_find_by_login_id(p_query text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_query text:=upper(btrim(coalesce(p_query,'')));
begin
  if auth.uid() is null or not public.sas_can_manage_school() then
    raise exception 'Keine Rollenverwaltungsberechtigung.';
  end if;
  if v_query !~ '^SAS-[A-Z2-9]{10}$' then
    raise exception 'Bitte eine vollständige Bürgerkennung angeben.';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,'login_id',r.login_id,'system_role',p.role,
      'verified',p.school_verified_at is not null,
      'jobs',coalesce((
        select jsonb_agg(a.role_slug order by a.role_slug)
        from public.school_role_assignments a where a.user_id=p.id
      ),'[]'::jsonb)
    )),'[]'::jsonb)
    from public.school_roster_members r
    join public.profiles p on p.id=r.user_id
    where r.active and r.login_id=v_query
  );
end
$$;

create or replace function public.attendance_session_roster_ids(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.sas_can_check_attendance() then
    raise exception 'Keine Berechtigung zur Anwesenheitskontrolle.';
  end if;
  if not exists(select 1 from public.attendance_sessions where id=p_session_id) then
    raise exception 'Anwesenheitsliste nicht gefunden.';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'login_id',r.login_id,'scanned_at',a.scanned_at
    ) order by a.scanned_at desc),'[]'::jsonb)
    from public.attendance_scans a
    join public.school_roster_members r on r.user_id=a.user_id
    where a.session_id=p_session_id
  );
end
$$;

create or replace function public.scan_attendance_pass_ids(p_code text,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v jsonb;
begin
  v:=public.scan_attendance_pass(p_code,p_session_id);
  return v - 'display_name' - 'class_label';
end
$$;

create or replace function public.scan_printed_card_attendance_ids(
  p_code text,p_session_id uuid,p_identity_checked boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v jsonb;
begin
  v:=public.scan_printed_card_attendance(p_code,p_session_id,p_identity_checked);
  return v - 'display_name' - 'class_label';
end
$$;

create or replace function public.admin_lookup_credit_card_ids(p_code text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb; v_login text;
begin
  v:=public.admin_lookup_credit_card(p_code);
  select r.login_id into v_login from public.school_roster_members r
  where r.user_id=(v->>'user_id')::uuid and r.active;
  if v_login is null then raise exception 'Keine gültige Bürgerkennung gefunden.'; end if;
  return (v - 'display_name' - 'class_label') ||
    jsonb_build_object('login_id',v_login);
end
$$;

create or replace function public.admin_credit_scanned_card_ids(
  p_code text,p_amount_cents integer,p_operation_id uuid,
  p_note text default ''
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v jsonb;
begin
  v:=public.admin_credit_scanned_card(p_code,p_amount_cents,p_operation_id,p_note);
  return v - 'recipient';
end
$$;

create or replace function public.my_printed_card_data_ids()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  return public.my_printed_card_data() - 'name' - 'class_label';
end
$$;

create or replace function public.admin_printed_card_data_ids(p_login_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  return public.admin_printed_card_data(p_login_id) - 'name' - 'class_label';
end
$$;

create or replace function public.admin_printed_card_orders_ids()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  return (select coalesce(jsonb_agg(item - 'class_label'),'[]'::jsonb)
    from jsonb_array_elements(public.admin_printed_card_orders()) as item);
end
$$;

revoke all on function public.admin_list_user_ids() from public,anon;
revoke all on function public.school_role_find_by_login_id(text) from public,anon;
revoke all on function public.attendance_session_roster_ids(uuid) from public,anon;
revoke all on function public.scan_attendance_pass_ids(text,uuid) from public,anon;
revoke all on function public.scan_printed_card_attendance_ids(text,uuid,boolean) from public,anon;
revoke all on function public.admin_lookup_credit_card_ids(text) from public,anon;
revoke all on function public.admin_credit_scanned_card_ids(text,integer,uuid,text) from public,anon;
revoke all on function public.my_printed_card_data_ids() from public,anon;
revoke all on function public.admin_printed_card_data_ids(text) from public,anon;
revoke all on function public.admin_printed_card_orders_ids() from public,anon;

grant execute on function public.admin_list_user_ids() to authenticated;
grant execute on function public.school_role_find_by_login_id(text) to authenticated;
grant execute on function public.attendance_session_roster_ids(uuid) to authenticated;
grant execute on function public.scan_attendance_pass_ids(text,uuid) to authenticated;
grant execute on function public.scan_printed_card_attendance_ids(text,uuid,boolean) to authenticated;
grant execute on function public.admin_lookup_credit_card_ids(text) to authenticated;
grant execute on function public.admin_credit_scanned_card_ids(text,integer,uuid,text) to authenticated;
grant execute on function public.my_printed_card_data_ids() to authenticated;
grant execute on function public.admin_printed_card_data_ids(text) to authenticated;
grant execute on function public.admin_printed_card_orders_ids() to authenticated;

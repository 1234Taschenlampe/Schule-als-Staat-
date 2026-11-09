-- Additional easy-to-type login aliases. Existing school roster IDs and Auth IDs stay stable.
alter table public.school_roster_members add column if not exists short_login_id text;
create unique index if not exists school_roster_short_login_id_unique
  on public.school_roster_members(short_login_id) where short_login_id is not null;
alter table public.school_roster_members
  add constraint school_roster_short_login_format
  check (short_login_id is null or short_login_id ~ '^SAS-[0-9]{6}$');

do $$
declare rec record; candidate text; entropy bytea; tries integer;
begin
  for rec in select user_id from public.school_roster_members
      where short_login_id is null order by user_id loop
    tries:=0;
    loop
      tries:=tries+1;
      if tries>100 then raise exception 'Could not allocate unique short citizen ID'; end if;
      entropy:=extensions.gen_random_bytes(4);
      candidate:='SAS-' || lpad((100000+(
        (get_byte(entropy,0)::bigint*16777216+
         get_byte(entropy,1)::bigint*65536+
         get_byte(entropy,2)::bigint*256+
         get_byte(entropy,3)::bigint)%900000
      ))::text,6,'0');
      begin
        update public.school_roster_members
          set short_login_id=candidate where user_id=rec.user_id and short_login_id is null;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
  end loop;
end
$$;

create or replace function public.my_short_login_id()
returns text language sql stable security definer set search_path=''
as $$ select coalesce(r.short_login_id,r.login_id)
  from public.school_roster_members r
  where r.user_id=auth.uid() and r.active limit 1 $$;
revoke all on function public.my_short_login_id() from public,anon;
grant execute on function public.my_short_login_id() to authenticated;

create or replace function public.admin_list_user_ids()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
 if auth.uid() is null or not exists(
  select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'
 ) then raise exception 'Keine Administratorberechtigung.'; end if;
 return (
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'login_id',coalesce(r.short_login_id,r.login_id,'Verwaltung'),
   'role',p.role,'vote_eligible',p.vote_eligible
  ) order by r.short_login_id nulls last),'[]'::jsonb)
  from public.profiles p left join public.school_roster_members r on r.user_id=p.id
 );
end
$$;
revoke all on function public.admin_list_user_ids() from public,anon;
grant execute on function public.admin_list_user_ids() to authenticated;

create or replace function public.school_role_find_by_login_id(p_query text)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_query text:=upper(btrim(coalesce(p_query,'')));
begin
 if auth.uid() is null or not public.sas_can_manage_school() then
  raise exception 'Keine Rollenverwaltungsberechtigung.'; end if;
 if v_query !~ '^(SAS-[0-9]{6}|SAS-[A-Z2-9]{10})$' then
  raise exception 'Bitte die vollständige Bürgerkennung eingeben.'; end if;
 return (
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'login_id',coalesce(r.short_login_id,r.login_id),
   'system_role',p.role,'verified',p.school_verified_at is not null,
   'jobs',coalesce((select jsonb_agg(a.role_slug order by a.role_slug)
      from public.school_role_assignments a where a.user_id=p.id),'[]'::jsonb)
  )),'[]'::jsonb)
  from public.school_roster_members r join public.profiles p on p.id=r.user_id
  where r.active and (r.short_login_id=v_query or r.login_id=v_query)
 );
end
$$;
revoke all on function public.school_role_find_by_login_id(text) from public,anon;
grant execute on function public.school_role_find_by_login_id(text) to authenticated;

-- Limit printed and screen-visible card data to non-name identifiers.
create or replace function public.my_printed_card_data_ids()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v jsonb; alias_id text;
begin
 v:=public.my_printed_card_data();
 alias_id:=public.my_short_login_id();
 return (v - 'name' - 'class_label')||jsonb_build_object('login_id',alias_id);
end $$;

create or replace function public.admin_printed_card_data_ids(p_login_id text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v jsonb; real_id text; short_id text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then
  raise exception 'Keine Administratorberechtigung.';end if;
 select r.login_id, coalesce(r.short_login_id,r.login_id) into real_id,short_id
 from public.school_roster_members r where r.active
 and (r.login_id=upper(btrim(p_login_id)) or r.short_login_id=upper(btrim(p_login_id)))
 limit 1;
 if real_id is null then raise exception 'Kennung nicht gefunden.';end if;
 v:=public.admin_printed_card_data(real_id);
 return (v - 'name' - 'class_label')||jsonb_build_object('login_id',short_id);
end $$;

create or replace function public.admin_printed_card_orders_ids()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then
  raise exception 'Keine Administratorberechtigung.';end if;
 return (
   select coalesce(jsonb_agg(jsonb_build_object(
      'login_id',coalesce(r.short_login_id,r.login_id),
      'status',o.status,'created_at',o.created_at,'updated_at',o.updated_at
   ) order by o.created_at desc),'[]'::jsonb)
   from (select * from public.printed_card_orders order by created_at desc limit 100) o
   join public.school_roster_members r on r.user_id=o.user_id
 );
end $$;

create or replace function public.admin_lookup_credit_card_ids(p_code text)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v jsonb; v_login text;
begin
 v:=public.admin_lookup_credit_card(p_code);
 select coalesce(r.short_login_id,r.login_id) into v_login
  from public.school_roster_members r
  where r.user_id=(v->>'user_id')::uuid and r.active;
 if v_login is null then raise exception 'Bürgerkennung nicht gefunden.';end if;
 return (v - 'display_name' - 'class_label')||jsonb_build_object('login_id',v_login);
end $$;

create or replace function public.attendance_session_roster_ids(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
 if auth.uid() is null or not public.sas_can_check_attendance() then
  raise exception 'Keine Berechtigung zur Anwesenheitskontrolle.';end if;
 if not exists(select 1 from public.attendance_sessions where id=p_session_id) then
  raise exception 'Anwesenheitsliste nicht gefunden.';end if;
 return (
  select coalesce(jsonb_agg(jsonb_build_object(
   'login_id',coalesce(r.short_login_id,r.login_id),'scanned_at',a.scanned_at
  ) order by a.scanned_at desc),'[]'::jsonb)
  from public.attendance_scans a join public.school_roster_members r on r.user_id=a.user_id
  where a.session_id=p_session_id
 );
end $$;

create or replace function public.scan_attendance_pass_ids(p_code text,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v jsonb; target_id uuid; alias_id text; clean_token text:=lower(btrim(coalesce(p_code,'')));
begin
 if left(clean_token,11)='sas-attend:' then clean_token:=substr(clean_token,12);end if;
 if clean_token ~ '^[0-9a-f]{64}$' then
  select a.user_id into target_id from public.attendance_passes a
  where a.token_hash=extensions.digest(clean_token,'sha256')
  and a.expires_at>now() limit 1;
 end if;
 v:=public.scan_attendance_pass(p_code,p_session_id);
 select coalesce(r.short_login_id,r.login_id) into alias_id from public.school_roster_members r
 where r.user_id=target_id and r.active;
 return (v - 'display_name' - 'class_label') ||
  jsonb_build_object('login_id',coalesce(alias_id,'Bürgerkonto'));
end $$;

create or replace function public.scan_printed_card_attendance_ids(
  p_code text,p_session_id uuid,p_identity_checked boolean
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v jsonb; alias_id text; code text:=lower(btrim(coalesce(p_code,'')));
begin
 if left(code,7)='sas-id:' then code:=substr(code,8);end if;
 select coalesce(r.short_login_id,r.login_id) into alias_id
 from public.student_card_codes s join public.school_roster_members r on r.user_id=s.user_id
 where s.code=code or s.short_code=code limit 1;
 v:=public.scan_printed_card_attendance(p_code,p_session_id,p_identity_checked);
 return (v - 'display_name' - 'class_label') ||
  jsonb_build_object('login_id',coalesce(alias_id,'Bürgerkonto'));
end $$;

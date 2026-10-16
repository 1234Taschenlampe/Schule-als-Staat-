-- Attendance rosters contain student personal data. Only authorized attendance staff can view.
create or replace function public.attendance_session_roster(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_data jsonb;
begin
 if not public.sas_can_check_attendance() then
   raise exception 'Nur berechtigte Anwesenheitskontrolleure dürfen Teilnehmerlisten sehen.';
 end if;
 if not exists(select 1 from public.attendance_sessions where id=p_session_id) then
   raise exception 'Anwesenheitsliste nicht gefunden.';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'display_name',s.display_name,
   'class_label',s.class_label,
   'scanned_at',a.scanned_at
 ) order by a.scanned_at desc),'[]'::jsonb)
 into v_data from public.attendance_scans a
 join public.student_cards s on s.user_id=a.user_id
 where a.session_id=p_session_id;
 return v_data;
end;
$$;
revoke all on function public.attendance_session_roster(uuid) from public,anon,authenticated;
grant execute on function public.attendance_session_roster(uuid) to authenticated;

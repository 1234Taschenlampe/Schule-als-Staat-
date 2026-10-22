-- Permanent opaque student card ID, never a payment authorization.
create table if not exists public.student_card_codes (
 user_id uuid primary key references auth.users(id) on delete cascade,
 code text not null unique default encode(extensions.gen_random_bytes(24),'hex'),
 created_at timestamptz not null default now()
);
alter table public.student_card_codes enable row level security;
revoke all on public.student_card_codes from public,anon,authenticated;

create or replace function public.my_student_card_code()
returns text language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_code text;
begin
 if v_uid is null then raise exception 'Anmeldung erforderlich.'; end if;
 insert into public.student_card_codes(user_id) values(v_uid)
 on conflict(user_id) do nothing;
 select code into v_code from public.student_card_codes where user_id=v_uid;
 return 'SAS-ID:'||v_code;
end;
$$;
revoke all on function public.my_student_card_code() from public,anon,authenticated;
grant execute on function public.my_student_card_code() to authenticated;

create or replace function public.lookup_student_card(p_code text)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_code text:=lower(btrim(coalesce(p_code,''))); v_result jsonb;
begin
 if not public.work_is_checker() then raise exception 'Keine Berechtigung zur Ausweisprüfung.'; end if;
 if left(v_code,7)='sas-id:' then v_code:=substr(v_code,8); end if;
 select jsonb_build_object('display_name',p.display_name,'class_label',c.class_label,
 'school_verified',p.school_verified_at is not null,'user_id',p.id)
 into v_result from public.student_card_codes sc
 join public.profiles p on p.id=sc.user_id
 left join public.student_cards c on c.user_id=p.id
 where sc.code=v_code;
 if v_result is null then raise exception 'Ausweis nicht gefunden.'; end if;
 return v_result;
end;
$$;
revoke all on function public.lookup_student_card(text) from public,anon,authenticated;
grant execute on function public.lookup_student_card(text) to authenticated;

create or replace function public.scan_work_token(p_code text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare v_uid uuid; v_code text:=lower(btrim(coalesce(p_code,''))); v_day date:=(now() at time zone 'Europe/Berlin')::date; v_shift public.work_shifts%rowtype; v_action text;
begin
 if not public.work_is_checker() then raise exception 'Keine Berechtigung zur Arbeitszeiterfassung.'; end if;
 if v_day not between date '2027-07-12' and date '2027-07-16' then raise exception 'Außerhalb der Projektwoche.'; end if;
 if left(v_code,7)='sas-id:' then v_code:=substr(v_code,8); end if;
 select user_id into v_uid from public.student_card_codes where code=v_code;
 if v_uid is null then raise exception 'Unbekannter Schülerausweis.'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_uid and p.school_verified_at is not null)
 then raise exception 'Schülerkonto nicht verifiziert.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,73421));
 select * into v_shift from public.work_shifts where user_id=v_uid and ended_at is null for update;
 if found then
   if v_shift.work_day<>v_day then raise exception 'Offene Schicht vom Vortag: Verwaltung muss diese prüfen.'; end if;
   if now()-v_shift.started_at<interval '1 minute' then raise exception 'Erneuter Scan zu früh.'; end if;
   update public.work_shifts set ended_at=now(),ended_by=auth.uid() where id=v_shift.id;
   v_action:='ended';
 else
   insert into public.work_shifts(user_id,work_day,started_by) values(v_uid,v_day,auth.uid());
   v_action:='started';
 end if;
 return jsonb_build_object('action',v_action,'work_day',v_day);
end;
$$;
revoke all on function public.scan_work_token(text) from public,anon,authenticated;
grant execute on function public.scan_work_token(text) to authenticated;

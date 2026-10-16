-- Operator may create, close, review polls and verify students; admin-only finances remain unchanged.

create or replace function public.admin_create_poll(
  p_title text,p_description text,p_options text[]
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_n int; v_option text; v_index int := 0;
begin
  if v_uid is null or not public.sas_can_manage_school() then
    raise exception 'Nur die Administration darf Abstimmungen erstellen.';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 5 and 160 then
    raise exception 'Titel muss zwischen 5 und 160 Zeichen lang sein.';
  end if;
  if p_options is null then raise exception 'Mindestens zwei Optionen erforderlich.'; end if;
  v_n:=coalesce(array_length(p_options,1),0);
  if v_n<2 or v_n>10 or array_ndims(p_options)<>1 then
    raise exception 'Es müssen 2 bis 10 Antwortoptionen angegeben werden.';
  end if;
  if exists(select 1 from unnest(p_options) as v(choice) where v.choice is null or char_length(btrim(v.choice)) not between 1 and 100) then
    raise exception 'Antwortoptionen müssen zwischen 1 und 100 Zeichen lang sein.';
  end if;
  if (select count(distinct lower(btrim(v.choice))) from unnest(p_options) as v(choice))<>v_n then
    raise exception 'Doppelte Antwortoptionen sind nicht erlaubt.';
  end if;
  insert into public.polls(title,description,created_by)
    values(btrim(p_title),left(coalesce(p_description,''),500),v_uid) returning id into v_id;
  foreach v_option in array p_options loop
    v_index:=v_index+1;
    insert into public.poll_options(poll_id,label,sort_order) values(v_id,btrim(v_option),v_index);
  end loop;
  return v_id;
end;
$$;

create or replace function public.admin_close_poll(p_poll_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.sas_can_manage_school() then
    raise exception 'Nur die Administration darf Abstimmungen schließen.';
  end if;
  update public.polls set status='closed',closed_at=now()
  where id=p_poll_id and status='open';
  if not found then raise exception 'Abstimmung nicht gefunden oder bereits geschlossen.'; end if;
  return true;
end;
$$;

create or replace function public.admin_poll_results()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_data jsonb;
begin
  if v_uid is null or not public.sas_can_manage_school() then
    raise exception 'Nur Administratoren sehen die Live-Auswertung.';
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',p.id,'title',p.title,'status',p.status,
      'total', (select count(*) from public.poll_ballots b where b.poll_id=p.id),
      'options',coalesce((
        select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,
          'count',(select count(*) from public.poll_ballots b where b.poll_id=p.id and b.option_id=o.id)
        ) order by o.sort_order)
        from public.poll_options o where o.poll_id=p.id
      ),'[]'::jsonb)
    ) order by p.created_at desc
  ),'[]'::jsonb) into v_data
  from (select * from public.polls order by created_at desc limit 50) p;
  return v_data;
end;
$$;

create or replace function public.review_school_verification_qr(p_code text)
returns jsonb
language plpgsql volatile security definer set search_path=''
as $$
declare
 v_token text := lower(btrim(coalesce(p_code,'')));
 v_hash bytea;
 v_name text;
 v_email text;
 v_class text;
 v_id uuid;
 v_time timestamptz;
begin
 if not public.sas_can_manage_school() then
   raise exception 'Nur autorisierte Schuladministratoren dürfen Codes prüfen.';
 end if;
 if left(v_token,11)='sas-verify:' then v_token:=substr(v_token,12); end if;
 if v_token !~ '^[0-9a-f]{64}$' then raise exception 'Kein gültiger Schul-QR-Code.'; end if;
 v_hash:=extensions.digest(v_token,'sha256');
 select p.id,p.display_name,u.email,coalesce(s.class_label,''),p.school_verified_at
 into v_id,v_name,v_email,v_class,v_time
 from public.school_verification_challenges c
 join public.profiles p on p.id=c.user_id
 join auth.users u on u.id=p.id
 left join public.student_cards s on s.user_id=p.id
 where c.token_hash=v_hash and c.expires_at>now();
 if v_id is null then raise exception 'QR-Code ist abgelaufen, ersetzt oder ungültig.'; end if;
 if v_time is not null then raise exception 'Konto wurde bereits schulisch verifiziert.'; end if;
 return jsonb_build_object('user_id',v_id,'display_name',v_name,'email',v_email,'class_label',v_class);
end;
$$;

create or replace function public.confirm_school_verification_qr(p_code text,p_identity_checked boolean)
returns jsonb
language plpgsql volatile security definer set search_path=''
as $$
declare
 v_token text := lower(btrim(coalesce(p_code,'')));
 v_hash bytea;
 v_uid uuid;
 v_name text;
begin
 if not public.sas_can_manage_school() then
   raise exception 'Keine Schulverifizierungsberechtigung.';
 end if;
 if p_identity_checked is distinct from true then
   raise exception 'Bitte die Identität vor Ort mit den Schulunterlagen abgleichen.';
 end if;
 if left(v_token,11)='sas-verify:' then v_token:=substr(v_token,12); end if;
 if v_token !~ '^[0-9a-f]{64}$' then raise exception 'Ungültiger QR-Code.'; end if;
 v_hash:=extensions.digest(v_token,'sha256');
 select c.user_id into v_uid from public.school_verification_challenges c
 where c.token_hash=v_hash and c.expires_at>now() for update;
 if v_uid is null then raise exception 'QR-Code ist abgelaufen, ersetzt oder bereits verbraucht.'; end if;
 update public.profiles p set school_verified_at=now(),school_verified_by=(select auth.uid())
 where p.id=v_uid and p.school_verified_at is null
 returning p.display_name into v_name;
 if v_name is null then raise exception 'Dieses Konto ist bereits verifiziert.'; end if;
 delete from public.school_verification_challenges where user_id=v_uid;
 -- Do NOT modify admin/cashier roles, wallet money, or voting rights.
 return jsonb_build_object('verified',true,'display_name',v_name,'user_id',v_uid);
end;
$$;

create or replace function public.sas_can_check_attendance()
returns boolean language sql stable security definer set search_path=''
as $$
 select (select auth.uid()) is not null and (
   exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin')
   or exists(select 1 from public.school_role_assignments a join public.school_job_roles j on j.slug=a.role_slug
     where a.user_id=(select auth.uid()) and j.attendance_permission)
   or exists(select 1 from public.attendance_checkers c where c.user_id=(select auth.uid()))
 );
$$;

revoke all on function public.sas_can_check_attendance() from public,anon,authenticated;
grant execute on function public.sas_can_check_attendance() to authenticated;

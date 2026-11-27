insert into auth.users(id,email,raw_app_meta_data)
select gen_random_uuid(), 'fixture-' || i || '@example.invalid',
 '{"sas_roster_provisioned":true,"sas_initial_password":true}'::jsonb
from generate_series(1,4) i;
insert into sas_private.designated_admin(user_id) select id from auth.users where email='fixture-4@example.invalid';
update public.profiles set role='admin' where id=(select id from auth.users where email='fixture-4@example.invalid');
update public.profiles set role='cashier' where id=(select id from auth.users where email='fixture-3@example.invalid');
update public.profiles set vote_eligible=true;
insert into public.school_roster_members(user_id,login_id,given_name,family_name,class_label)
select id,'SAS-AAAAAAAAAA','Test','Person','Test' from auth.users where email='fixture-1@example.invalid';
begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='fixture-1@example.invalid'),true);
set local role authenticated;
do $$
begin
 if (select count(*) from public.wallets)<>1 or exists(select from public.wallets where user_id<>auth.uid()) then
   raise exception 'Wallet isolation failed';
 end if;
 begin
   perform public.submit_vote(null,null);
   raise exception 'Initial password guard missing';
 exception when insufficient_privilege then
   if sqlerrm <> 'Bitte ändere zuerst dein einmaliges Startpasswort.' then raise; end if;
 end;
end $$;
rollback;

-- Validate the seeded application professions through their real grants and policies.
insert into auth.users(id,email,raw_app_meta_data)
select gen_random_uuid(),slug||'@example.invalid','{"sas_roster_provisioned":true}'::jsonb
from public.school_job_roles;
insert into public.school_role_assignments(user_id,role_slug,assigned_by)
select u.id,j.slug,u.id from public.school_job_roles j join auth.users u on u.email=j.slug||'@example.invalid';

create temporary table expectations as
select u.id,p.role,j.slug,coalesce(j.attendance_permission,false) as attendance
from auth.users u join public.profiles p on p.id=u.id
left join public.school_role_assignments a on a.user_id=u.id
left join public.school_job_roles j on j.slug=a.role_slug;
grant select on expectations to authenticated;
begin;
set local role authenticated;
do $$
declare person record;
begin
 for person in select * from expectations loop
  perform set_config('request.jwt.claim.sub',person.id::text,true);
  if public.sas_is_admin() <> (person.role='admin')
     or public.sas_is_operator() <> coalesce(person.slug='operator',false)
     or public.sas_can_manage_school() <> (person.role='admin' or coalesce(person.slug='operator',false))
     or public.sas_can_check_attendance() <> (person.role='admin' or person.attendance)
     or (select count(*) from public.wallets)<>1
     or not exists(select from public.wallets where user_id=person.id)
  then raise exception 'Role or wallet visibility mismatch for %/%',person.role,person.slug; end if;
 end loop;
 if has_table_privilege(current_user,'public.profiles','UPDATE') or
    has_table_privilege(current_user,'public.school_role_assignments','INSERT') or
    has_table_privilege(current_user,'public.school_roster_members','SELECT')
 then raise exception 'Direct role or roster privileges'; end if;
end $$;
rollback;
begin;
set local role anon;
do $$ begin
 if has_table_privilege(current_user,'public.wallets','SELECT') or
    has_function_privilege(current_user,'public.submit_vote(uuid,uuid)','EXECUTE')
 then raise exception 'Anonymous access to protected objects'; end if;
end $$;
rollback;

do $$ begin
 if exists(select from pg_class where relnamespace='public'::regnamespace
   and relkind in ('r','p') and not relrowsecurity)
 then raise exception 'Public table without RLS'; end if;
end $$;

do $$ begin
 if exists(select from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')
   and (has_table_privilege('anon',c.oid,'TRUNCATE,TRIGGER,REFERENCES')
     or has_table_privilege('authenticated',c.oid,'TRUNCATE,TRIGGER,REFERENCES')))
 then raise exception 'Browser role retains DDL or truncate rights'; end if;
end $$;

do $$
declare unexpected text;
begin
 select string_agg(p.proname,', ' order by p.proname) into unexpected
 from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef
 and has_function_privilege('anon',p.oid,'EXECUTE')
 and p.oid not in ('public.visa_public_settings()'::regprocedure,'public.verify_guest_visa_email(text)'::regprocedure);
 if unexpected is not null then raise exception 'Unexpected anonymous definer functions: %',unexpected; end if;
 if exists(select from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef
   and not coalesce('search_path=""'=any(p.proconfig),false))
 then raise exception 'Unpinned definer search path'; end if;
end $$;

begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='fixture-3@example.invalid'),true);
set local role authenticated;
do $$ begin
 begin
  perform public.create_payment_request(100,'fixture');
  raise exception 'Cashier with initial password created a payment request';
 exception when insufficient_privilege then
  if sqlerrm<>'Bitte ändere zuerst dein einmaliges Startpasswort.' then raise; end if;
 end;
end $$;
commit;
update auth.users set encrypted_password='synthetic-changed-hash' where email='fixture-3@example.invalid';
begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='fixture-3@example.invalid'),true);
set local role authenticated;
select public.create_payment_request(100,'fixture');
commit;

begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='fixture-1@example.invalid'),true);
set local role authenticated;
select public.acknowledge_school_legal(true,true);
rollback;

update public.wallets set balance_cents=100 where user_id=(select id from auth.users where email='seller@example.invalid');

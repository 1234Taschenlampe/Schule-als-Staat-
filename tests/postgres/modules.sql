-- Compare the owner's and another delegated user's normal module queries.
insert into public.school_events(title, starts_at, ends_at, created_by)
select 'Testtermin',now()+interval '1 day',now()+interval '2 days',id from auth.users where email='fixture-4@example.invalid';
insert into public.event_rsvps(event_id,user_id)
select e.id,u.id from public.school_events e, auth.users u where e.title='Testtermin' and u.email='seller@example.invalid';
insert into public.civic_posts(kind,title,body,created_by)
select 'job','Teststelle','Beispiel',id from auth.users where email='fixture-4@example.invalid';
insert into public.job_applications(job_id, applicant_id, motivation)
select j.id,u.id,'Testbewerbung' from public.civic_posts j,auth.users u where j.title='Teststelle' and u.email='seller@example.invalid';
insert into public.portal_posts(section,title,body,author_id,published)
select 'blog','Entwurf','Beispiel',id,false from auth.users where email='fixture-4@example.invalid';
insert into public.lost_items(created_by,kind,title,detail)
select id,'found','Beispiel','Testgegenstand' from auth.users where email='seller@example.invalid';

begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='editor@example.invalid'),true);
set local role authenticated;
do $$ begin
 if exists(select from public.event_rsvps) or exists(select from public.job_applications)
 or exists(select from public.portal_posts where not published)
 or has_column_privilege(current_user,'public.school_competition_entries','submitted_by','SELECT')
 then raise exception 'Foreign private records or attribution visible'; end if;
 delete from public.lost_items where title='Beispiel';
 if found then raise exception 'Foreign lost item deleted'; end if;
end $$;
rollback;
begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='seller@example.invalid'),true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.event_rsvps)<>1 or (select count(*) from public.job_applications)<>1
 then raise exception 'Own participation records unavailable'; end if;
 delete from public.lost_items where title='Beispiel';
 if not found then raise exception 'Owner cannot withdraw open item'; end if;
end $$;
rollback;

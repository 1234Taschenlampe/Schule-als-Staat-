-- Run only in the disposable integration database.
begin;
update auth.users set encrypted_password='synthetic-rotated-admin' where email='fixture-4@example.invalid';
create temp table visa_fixture(k text primary key,v jsonb);
grant all on visa_fixture to authenticated,service_role;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='fixture-4@example.invalid'),true);
set local role authenticated;
insert into visa_fixture values('station',public.onsite_visa_staff('station_add','{"label":"Teststation"}'));
reset role;
set local role service_role;
do $ begin
 if public.onsite_visa_access('station_quote',(select v->>'station_key' from visa_fixture where k='station'),'{}')->>'enabled'<>'false' then raise exception 'Disabled station login failed'; end if;
 begin perform public.onsite_visa_access('station_create',(select v->>'station_key' from visa_fixture where k='station'),'{}');raise exception 'Disabled station accepted registration';exception when insufficient_privilege then null;end;
end $;
reset role;
set local role authenticated;
select public.onsite_visa_staff('configure','{"enabled":true,"daily_price_cents":200}');
reset role;
set local role service_role;
insert into visa_fixture values('pass',public.onsite_visa_access('station_create',(select v->>'station_key' from visa_fixture where k='station'),jsonb_build_object('request_id','11111111-2222-4333-8444-555555555555','guest_key',repeat('a',64),'valid_from','2027-07-12','valid_to','2027-07-14')));
do $$ begin
 if (select v->>'price_cents' from visa_fixture where k='pass')<>'600' then raise exception 'Price calculation failed'; end if;
 if public.onsite_visa_access('guest_status',repeat('a',64),'{}')->>'status'<>'pending' then raise exception 'Unpaid guest active';end if;
 begin
  perform public.onsite_visa_access('station_quote',repeat('b',64),'{}');
  raise exception 'Invalid station accepted';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='fixture-1@example.invalid'),true);
set local role authenticated;
do $$ begin
 begin perform public.onsite_visa_staff('lookup',jsonb_build_object('id',(select v->>'id' from visa_fixture where k='pass')));raise exception 'Citizen read application';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='operator@example.invalid'),true);
set local role authenticated;
do $$ declare a jsonb:=jsonb_build_object('id',(select v->>'id' from visa_fixture where k='pass'),'amount_cents',600,'verified',true,'cash_received',true); r jsonb;begin
 begin perform public.onsite_visa_staff('confirm',a||'{"amount_cents":1}');raise exception 'Wrong price accepted';
 exception when raise_exception then if sqlerrm='Wrong price accepted' then raise;end if;end;
 r:=public.onsite_visa_staff('confirm',a);
 if r->>'paid_at' is null then raise exception 'Payment not recorded';end if;
 if public.onsite_visa_staff('confirm',a)->>'paid_at' is distinct from r->>'paid_at' then raise exception 'Duplicate confirmation';end if;
 begin perform public.onsite_visa_staff('refund',a||'{"cash_returned":true,"reason":"test"}');raise exception 'Operator refunded';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='fixture-4@example.invalid'),true);
set local role authenticated;
select public.onsite_visa_staff('refund',jsonb_build_object('id',(select v->>'id' from visa_fixture where k='pass'),'cash_returned',true,'reason','Synthetic refund'));
do $$ begin
 if public.onsite_visa_staff('report','{}')->>'refund_cents'<>'600' then raise exception 'Refund not recorded';end if;
end $$;
reset role;
set local role service_role;
do $$ begin
 if public.onsite_visa_access('guest_status',repeat('a',64),'{}')->>'status'<>'refunded' then raise exception 'Refund did not revoke pass';end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.onsite_visa_access(text,text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.onsite_visa_access(text,text,jsonb)','EXECUTE') or has_function_privilege('anon','public.onsite_visa_staff(text,jsonb)','EXECUTE') or has_schema_privilege('authenticated','sas_onsite','USAGE') then raise exception 'Unexpected browser grants';end if;
end $$;
rollback;
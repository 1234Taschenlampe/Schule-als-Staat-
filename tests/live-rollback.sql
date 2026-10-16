-- Backend integration test only. Entire transaction rolls back, including fictional users.
-- Never replace ROLLBACK with COMMIT. No real user data is read or modified.
begin;
do $$
declare a uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
begin
 perform set_config('qa.admin',a::text,true); perform set_config('qa.member',m::text,true); perform set_config('qa.cashier',c::text,true);
 insert into auth.users(id,aud,role,email,email_confirmed_at) values
 (a,'authenticated','authenticated','qa-admin-'||a||'@example.test',now()),
 (m,'authenticated','authenticated','qa-member-'||m||'@example.test',now()),
 (c,'authenticated','authenticated','qa-cashier-'||c||'@example.test',now());
 insert into public.profiles(id,display_name,role,vote_eligible) values(a,'QA Admin','admin',true),(m,'QA Mitglied','member',true),(c,'QA Kasse','cashier',false)
 on conflict(id) do update set display_name=excluded.display_name,role=excluded.role,vote_eligible=excluded.vote_eligible;
 insert into public.wallets(user_id,balance_cents) values(a,0),(m,1000),(c,0) on conflict(user_id) do update set balance_cents=excluded.balance_cents;
 insert into public.student_cards(user_id,display_name,class_label) values(a,'QA Admin','QA'),(m,'QA Mitglied','QA');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('qa.cashier'),true);
select set_config('qa.request',public.create_payment_request(250,'Isolierter Rollback-Test')::text,true);
select set_config('request.jwt.claim.sub',current_setting('qa.member'),true);
do $$
declare count_cards int; first_result jsonb; repeat_result jsonb; denied boolean:=false;
begin
 select count(*) into count_cards from public.student_cards where user_id in(current_setting('qa.admin')::uuid,current_setting('qa.member')::uuid);
 if count_cards<>1 then raise exception 'RLS: fremder Ausweis sichtbar'; end if;
 begin perform public.admin_list_users(); exception when others then denied:=true; end;
 if not denied then raise exception 'Mitglied hat Adminzugriff'; end if;
 first_result:=public.settle_payment_request(current_setting('qa.request')::uuid);
 repeat_result:=public.settle_payment_request(current_setting('qa.request')::uuid);
 if first_result->>'already_paid'<>'false' or repeat_result->>'already_paid'<>'true' then raise exception 'Zahlungswiederholung nicht idempotent'; end if;
 if (select balance_cents from public.wallets where user_id=current_setting('qa.member')::uuid)<>750 then raise exception 'Falscher Saldo'; end if;
 denied:=false;
 begin insert into public.student_cards(user_id,display_name) values(current_setting('qa.cashier')::uuid,'Fremde Karte'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'RLS: fremder Ausweis beschreibbar'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('qa.admin'),true);
select set_config('qa.poll',public.admin_create_poll('QA Rollback Test','Keine echte Abstimmung',array['Test A','Test B'])::text,true);
select set_config('request.jwt.claim.sub',current_setting('qa.member'),true);
do $$
declare option_id uuid; denied boolean:=false;
begin
 select (item->'options'->0->>'id')::uuid into option_id from jsonb_array_elements(public.poll_catalog()) item where item->>'id'=current_setting('qa.poll');
 if option_id is null then raise exception 'Katalog ohne Optionen'; end if;
 perform public.submit_vote(current_setting('qa.poll')::uuid,option_id);
 begin perform public.submit_vote(current_setting('qa.poll')::uuid,option_id); exception when others then denied:=true; end;
 if not denied then raise exception 'Doppelte Stimmabgabe möglich'; end if;
 denied:=false;
 begin perform public.admin_poll_results(); exception when others then denied:=true; end;
 if not denied then raise exception 'Mitglied sieht Adminauswertung'; end if;
end $$;
reset role;
select 'PASS: RLS-Ausweis, Fremdschreiben, Adminsperre, Zahlung, Wiederholung, Saldo, Wahl und Doppelstimme; alle Testdaten zurückgerollt' as result;
rollback;

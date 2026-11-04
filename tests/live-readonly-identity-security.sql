-- SCHOOL-AS-STATE NON-DESTRUCTIVE DATABASE AUTHORIZATION TEST
-- Run in a privileged private Supabase SQL session, NEVER in the browser or a public CI log.
-- Does not authenticate through GoTrue or HTTP and cannot replace real device/JWT E2E tests.
-- No student identity, name, password, email, ballot or session token is returned.
-- Every role scenario is READ ONLY and explicitly ROLLBACKs. Never run a modified script.
-- Test prerequisites: two ordinary, active citizens; one operator; one admin.
-- Last verified in production: 2026-11-04.

-- Case A: unauthenticated public role
BEGIN READ ONLY;
SET LOCAL ROLE anon;
DO $test$
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'FAIL: anonymous auth.uid()'; END IF;
 IF has_table_privilege('anon','public.school_roster_members','SELECT')
    OR has_table_privilege('anon','public.student_cards','SELECT')
    OR has_function_privilege('anon','public.submit_vote(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'FAIL: anonymous account/ballot access'; END IF;
END $test$;
ROLLBACK;

-- Case B: ordinary citizen who has not yet changed their seven-digit start PIN
BEGIN READ ONLY;
DO $setup$ BEGIN
 PERFORM set_config('request.jwt.claim.sub',(
  SELECT r.user_id::text FROM public.school_roster_members r
  JOIN auth.users u ON u.id=r.user_id
  WHERE r.active AND u.raw_app_meta_data->>'sas_initial_password'='true'
    AND NOT EXISTS (SELECT 1 FROM public.school_role_assignments a WHERE a.user_id=r.user_id)
  ORDER BY r.user_id LIMIT 1),true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_cnt int; v_denied boolean:=false; v_pin_denied boolean:=false;
BEGIN
 IF auth.uid() IS NULL OR public.sas_is_admin() OR public.sas_is_operator() THEN
  RAISE EXCEPTION 'FAIL: missing ordinary citizen context';
 END IF;
 SELECT count(*) INTO v_cnt FROM public.profiles;
 IF v_cnt<>1 THEN RAISE EXCEPTION 'FAIL: own profile RLS %',v_cnt; END IF;
 SELECT count(*) INTO v_cnt FROM public.student_cards;
 IF v_cnt<>1 THEN RAISE EXCEPTION 'FAIL: own card RLS %',v_cnt; END IF;
 SELECT count(*) INTO v_cnt FROM public.wallets;
 IF v_cnt<>1 THEN RAISE EXCEPTION 'FAIL: own wallet RLS %',v_cnt; END IF;
 IF has_table_privilege('authenticated','public.school_roster_members','SELECT') THEN
  RAISE EXCEPTION 'FAIL: direct citizen roster SELECT';
 END IF;
 BEGIN PERFORM public.admin_list_users(); EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Keine Administratorberechtigung.' THEN v_denied:=true; ELSE RAISE; END IF;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FAIL: citizen can export users'; END IF;
 BEGIN PERFORM public.submit_vote(NULL,NULL); EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Bitte ändere zuerst dein einmaliges Startpasswort.'
  THEN v_pin_denied:=true; ELSE RAISE; END IF;
 END;
 IF NOT v_pin_denied THEN RAISE EXCEPTION 'FAIL: unchanged PIN can vote'; END IF;
END $test$;
ROLLBACK;

-- Case C: second, independent ordinary citizen
BEGIN READ ONLY;
DO $setup$ BEGIN
 PERFORM set_config('request.jwt.claim.sub',(
  SELECT r.user_id::text FROM public.school_roster_members r
  WHERE r.active AND NOT EXISTS (
   SELECT 1 FROM public.school_role_assignments a WHERE a.user_id=r.user_id)
  ORDER BY r.user_id OFFSET 1 LIMIT 1),true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_cnt int; v_denied boolean:=false; v_name text;
BEGIN
 IF auth.uid() IS NULL OR public.sas_is_operator() OR public.sas_is_admin() THEN
  RAISE EXCEPTION 'FAIL: second citizen context'; END IF;
 SELECT count(*) INTO v_cnt FROM public.profiles;
 IF v_cnt<>1 THEN RAISE EXCEPTION 'FAIL: second citizen profile RLS %',v_cnt; END IF;
 SELECT count(*) INTO v_cnt FROM public.student_cards;
 IF v_cnt<>1 THEN RAISE EXCEPTION 'FAIL: second citizen card RLS %',v_cnt; END IF;
 SELECT count(*) INTO v_cnt FROM public.wallets;
 IF v_cnt<>1 THEN RAISE EXCEPTION 'FAIL: second citizen wallet RLS %',v_cnt; END IF;
 SELECT public.my_secure_school_name() INTO v_name;
 IF v_name IS NULL OR char_length(v_name)<2 THEN
  RAISE EXCEPTION 'FAIL: cannot resolve own secure name'; END IF;
 BEGIN PERFORM public.admin_poll_results(); EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Nur Administratoren sehen die Live-Auswertung.'
  THEN v_denied:=true; ELSE RAISE; END IF;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FAIL: citizen can view admin poll results'; END IF;
END $test$;
ROLLBACK;

-- Case D: actual assigned operator, but no admin authority
BEGIN READ ONLY;
DO $setup$ BEGIN
 PERFORM set_config('request.jwt.claim.sub',(
  SELECT a.user_id::text FROM public.school_role_assignments a
  JOIN public.profiles p ON p.id=a.user_id
  WHERE a.role_slug='operator' AND p.role='member'
  ORDER BY a.user_id LIMIT 1),true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_denied boolean:=false;
BEGIN
 IF auth.uid() IS NULL OR NOT public.sas_is_operator() OR public.sas_is_admin() THEN
  RAISE EXCEPTION 'FAIL: operator role mixup'; END IF;
 BEGIN PERFORM public.admin_list_users(); EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Keine Administratorberechtigung.' THEN v_denied:=true; ELSE RAISE; END IF;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FAIL: operator has bulk admin export'; END IF;
END $test$;
ROLLBACK;

-- Case E: the existing admin, without enumerating or exporting citizens
BEGIN READ ONLY;
DO $setup$ BEGIN
 PERFORM set_config('request.jwt.claim.sub',(
  SELECT id::text FROM public.profiles WHERE role='admin' LIMIT 1),true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
 IF auth.uid() IS NULL OR NOT public.sas_is_admin() THEN
  RAISE EXCEPTION 'FAIL: school admin role not recognized'; END IF;
 IF NOT has_function_privilege('authenticated','public.admin_list_users()','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: admin function ACL missing'; END IF;
END $test$;
ROLLBACK;

-- No personal data is ever printed; if all checks finish without error, the
-- SQL-level isolation smoke test passed. A browser multi-account test is still required.

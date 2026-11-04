-- Strict official citizen roster enforcement, 2026-11-04.
-- Must not silently break the 991 imported accounts or alter identity verification.
-- This migration was applied to production after read-only count checks.
DO $sas$
DECLARE
  v_roster_count integer;
  v_complete_count integer;
  v_member_count integer;
  v_admin_count integer;
  v_stray_count integer;
BEGIN
  SELECT count(*) INTO v_roster_count FROM public.school_roster_members WHERE active;
  SELECT count(*) INTO v_complete_count
  FROM public.school_roster_members r
  JOIN auth.users u ON u.id=r.user_id
  JOIN public.profiles p ON p.id=r.user_id
  JOIN sas_private.school_names_encrypted n ON n.user_id=r.user_id
  WHERE r.active AND p.role='member'
    AND u.raw_app_meta_data->>'sas_roster_provisioned'='true'
    AND n.name_cipher IS NOT NULL AND length(n.name_cipher)>0;
  SELECT count(*) INTO v_member_count FROM public.profiles WHERE role='member';
  SELECT count(*) INTO v_admin_count FROM public.profiles WHERE role='admin';
  SELECT count(*) INTO v_stray_count FROM public.profiles p
  LEFT JOIN public.school_roster_members r ON r.user_id=p.id AND r.active
  WHERE p.role='member' AND r.user_id IS NULL;
  IF v_roster_count<>991 OR v_complete_count<>v_roster_count OR
     v_member_count<>v_roster_count OR v_admin_count<>1 OR
     v_stray_count<>0 OR EXISTS(SELECT 1 FROM public.school_test_accounts) THEN
    RAISE EXCEPTION 'Abgleich unvollständig: roster %, complete %, members %, admin %, missing %',
      v_roster_count,v_complete_count,v_member_count,v_admin_count,v_stray_count;
  END IF;
  UPDATE public.school_access_settings SET roster_enforced=true,updated_at=now() WHERE singleton IS TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'school_access_settings fehlt'; END IF;
END
$sas$;

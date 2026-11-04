-- Defense in depth: a vote_eligible flag alone never authorizes an unknown account.
-- Only active official roster citizens and the designated school admin may vote.
CREATE OR REPLACE FUNCTION public.submit_vote(p_poll_id uuid, p_option_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=(select auth.uid()); v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Anmeldung erforderlich.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=v_uid AND p.vote_eligible=true AND (
      p.role='admin' OR (p.role='member' AND EXISTS (
        SELECT 1 FROM public.school_roster_members r
        WHERE r.user_id=v_uid AND r.active
      ))
    )
  ) THEN
    RAISE EXCEPTION 'Dieses Konto ist nicht für die offizielle Abstimmung berechtigt.'
      USING ERRCODE='42501';
  END IF;
  -- Temporary seven-digit start PINs must be replaced before voting. The
  -- auth.users password trigger clears the flag only after a real hash change.
  IF EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id=v_uid AND u.raw_app_meta_data->>'sas_initial_password'='true'
  ) THEN
    RAISE EXCEPTION 'Bitte ändere zuerst dein einmaliges Startpasswort.'
      USING ERRCODE='42501';
  END IF;

  SELECT p.status INTO v_status FROM public.polls p WHERE p.id=p_poll_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Abstimmung nicht gefunden.'; END IF;
  IF v_status<>'open' THEN RAISE EXCEPTION 'Abstimmung ist geschlossen.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.poll_options o
    WHERE o.id=p_option_id AND o.poll_id=p_poll_id
  ) THEN RAISE EXCEPTION 'Antwortoption gehört nicht zu dieser Abstimmung.'; END IF;
  INSERT INTO public.poll_ballots(poll_id,voter_id,option_id)
  VALUES(p_poll_id,v_uid,p_option_id);
  RETURN true;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Du hast bereits abgestimmt.';
END
$function$;
REVOKE ALL ON FUNCTION public.submit_vote(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_vote(uuid,uuid) TO authenticated;

-- The approved organisational address is configured outside the public repository.
CREATE TABLE private.gi_reviewer_nomination (
  appointment text PRIMARY KEY CHECK(appointment='coordinator'),
  email text NOT NULL CHECK(email=lower(trim(email))),
  appointed_by uuid REFERENCES public.gi_profiles(id), appointed_at timestamptz
);
REVOKE ALL ON private.gi_reviewer_nomination FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.gi_reviewer_candidate() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT u.id FROM private.gi_reviewer_nomination n
 JOIN auth.users u ON lower(u.email)=n.email AND u.email_confirmed_at IS NOT NULL
 JOIN public.gi_profiles p ON p.id=u.id AND p.role='coordinator' AND p.registration_state='active'
 WHERE private.gi_role()='admin'
 AND EXISTS(SELECT FROM private.gi_time_reviewers WHERE appointment='chief' AND user_id=(SELECT auth.uid()))
 AND NOT EXISTS(SELECT FROM private.gi_time_reviewers WHERE appointment='coordinator')
$$;
CREATE FUNCTION private.gi_appoint_reviewer(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(3011,20261122);
  IF p_user IS NULL OR p_user IS DISTINCT FROM private.gi_reviewer_candidate()
    THEN RAISE EXCEPTION 'Paskyrimas neleidžiamas. Patikrinkite tapatybę ir pareigas.'; END IF;
  INSERT INTO private.gi_time_reviewers(appointment,user_id) VALUES('coordinator',p_user);
  UPDATE private.gi_reviewer_nomination SET appointed_by=auth.uid(),appointed_at=now() WHERE appointment='coordinator';
END $$;
CREATE FUNCTION public.gi_reviewer_candidate() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
 AS $$ SELECT private.gi_reviewer_candidate() $$;
CREATE FUNCTION public.gi_appoint_reviewer(p_user uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=''
 AS $$ SELECT private.gi_appoint_reviewer(p_user) $$;
REVOKE ALL ON FUNCTION private.gi_reviewer_candidate(),public.gi_reviewer_candidate(),private.gi_appoint_reviewer(uuid),public.gi_appoint_reviewer(uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_reviewer_candidate(),public.gi_reviewer_candidate(),private.gi_appoint_reviewer(uuid),public.gi_appoint_reviewer(uuid)
 TO authenticated;

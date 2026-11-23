-- GI real-case prototype. NEVER import real people / cases into synthetic gi_tasks/gi_incidents.
-- This migration is for isolated CI testing first. It is NOT an authorisation to
-- enable production until rollback, consent, access and file restoration are proven.

CREATE TABLE public.gi_real_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref text UNIQUE NOT NULL CHECK (char_length(btrim(external_ref)) BETWEEN 5 AND 120),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 5 AND 180),
  summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 5 AND 6000),
  sensitivity text NOT NULL DEFAULT 'restricted' CHECK (sensitivity IN ('restricted','internal')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','active','closed')),
  opened_by uuid NOT NULL REFERENCES public.gi_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gi_real_cases_status_idx ON public.gi_real_cases(status,updated_at DESC);
ALTER TABLE public.gi_real_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gi_real_cases FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.gi_real_cases TO authenticated;

CREATE TABLE public.gi_real_case_access (
  case_id uuid NOT NULL REFERENCES public.gi_real_cases(id),
  user_id uuid NOT NULL REFERENCES public.gi_profiles(id),
  can_upload boolean NOT NULL DEFAULT false,
  granted_by uuid NOT NULL REFERENCES public.gi_profiles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (case_id,user_id)
);
CREATE INDEX gi_real_case_access_user_idx ON public.gi_real_case_access(user_id,revoked_at);
ALTER TABLE public.gi_real_case_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gi_real_case_access FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.gi_real_case_access TO authenticated;

-- Do not expose access grant metadata to volunteers: even a case UUID can
-- leak that a restricted investigation exists.
CREATE POLICY gi_real_access_read ON public.gi_real_case_access FOR SELECT TO authenticated
USING ((SELECT private.gi_role()) IN ('admin','coordinator'));
CREATE POLICY gi_real_access_insert ON public.gi_real_case_access FOR INSERT TO authenticated
WITH CHECK ((SELECT private.gi_role()) IN ('admin','coordinator') AND granted_by=(SELECT auth.uid()));
CREATE POLICY gi_real_access_update ON public.gi_real_case_access FOR UPDATE TO authenticated
USING ((SELECT private.gi_role()) IN ('admin','coordinator'))
WITH CHECK ((SELECT private.gi_role()) IN ('admin','coordinator'));

-- Predicate used by case/storage RLS. SECURITY DEFINER avoids exposing the
-- private membership table to volunteers. Only the caller's OWN membership is
-- checked, and it returns a boolean, never names or case metadata.
CREATE FUNCTION private.gi_real_has_access(p_case uuid,p_upload boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
  SELECT (SELECT private.gi_role())='volunteer'
    AND EXISTS (
      SELECT 1 FROM public.gi_real_case_access a
      WHERE a.case_id=p_case AND a.user_id=(SELECT auth.uid())
        AND a.revoked_at IS NULL
        AND (NOT p_upload OR a.can_upload)
    )
$f$;
REVOKE ALL ON FUNCTION private.gi_real_has_access(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_real_has_access(uuid,boolean) TO authenticated;

-- Staff can see all assigned case records. Volunteers see only an explicitly
-- granted, unrevoked "internal" case, and never "restricted" cases.
CREATE POLICY gi_real_case_read ON public.gi_real_cases FOR SELECT TO authenticated
USING (
  (SELECT private.gi_role()) IN ('admin','coordinator')
  OR (sensitivity='internal'
      AND private.gi_real_has_access(gi_real_cases.id,false))
);
CREATE POLICY gi_real_case_create ON public.gi_real_cases FOR INSERT TO authenticated
WITH CHECK ((SELECT private.gi_role()) IN ('admin','coordinator')
            AND opened_by=(SELECT auth.uid()));
CREATE POLICY gi_real_case_edit ON public.gi_real_cases FOR UPDATE TO authenticated
USING ((SELECT private.gi_role()) IN ('admin','coordinator'))
WITH CHECK ((SELECT private.gi_role()) IN ('admin','coordinator'));

CREATE TABLE public.gi_real_case_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES public.gi_real_cases(id),
  actor_id uuid REFERENCES public.gi_profiles(id),
  event_type text NOT NULL CHECK (event_type IN ('created','updated','access_granted','access_changed')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gi_real_case_events_case_idx ON public.gi_real_case_events(case_id,recorded_at DESC);
ALTER TABLE public.gi_real_case_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gi_real_case_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.gi_real_case_events TO authenticated;
CREATE POLICY gi_real_case_events_read ON public.gi_real_case_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.gi_real_cases c WHERE c.id=case_id));

-- Immutable core identity fields and one-way sensitivity elevation.
CREATE FUNCTION private.gi_real_case_before_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.external_ref IS DISTINCT FROM OLD.external_ref
     OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Original case identity must not be changed.';
  END IF;
  IF OLD.sensitivity='restricted' AND NEW.sensitivity='internal' THEN
    RAISE EXCEPTION 'Restricted cases cannot be downgraded without separate review.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$f$;
CREATE TRIGGER gi_real_case_before_edit
BEFORE UPDATE ON public.gi_real_cases
FOR EACH ROW EXECUTE FUNCTION private.gi_real_case_before_edit();

-- Prevent staff from changing who originally granted access.
CREATE FUNCTION private.gi_real_access_before_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
  IF NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.granted_by IS DISTINCT FROM OLD.granted_by OR NEW.granted_at IS DISTINCT FROM OLD.granted_at THEN
      RAISE EXCEPTION 'The access grant identity is immutable.';
  END IF;
  RETURN NEW;
END
$f$;
CREATE TRIGGER gi_real_access_before_edit
BEFORE UPDATE ON public.gi_real_case_access
FOR EACH ROW EXECUTE FUNCTION private.gi_real_access_before_edit();

-- Append-only, minimised audit events: never copy descriptions or file contents.
CREATE FUNCTION private.gi_real_case_record_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
  IF TG_TABLE_NAME='gi_real_cases' THEN
    INSERT INTO public.gi_real_case_events(case_id,actor_id,event_type)
      VALUES(NEW.id,auth.uid(),CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END);
  ELSE
    INSERT INTO public.gi_real_case_events(case_id,actor_id,event_type)
      VALUES(NEW.case_id,auth.uid(),CASE WHEN TG_OP='INSERT' THEN 'access_granted' ELSE 'access_changed' END);
  END IF;
  RETURN NEW;
END
$f$;
CREATE TRIGGER gi_real_cases_audit AFTER INSERT OR UPDATE ON public.gi_real_cases
FOR EACH ROW EXECUTE FUNCTION private.gi_real_case_record_event();
CREATE TRIGGER gi_real_access_audit AFTER INSERT OR UPDATE ON public.gi_real_case_access
FOR EACH ROW EXECUTE FUNCTION private.gi_real_case_record_event();

REVOKE ALL ON FUNCTION private.gi_real_case_before_edit() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.gi_real_access_before_edit() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.gi_real_case_record_event() FROM PUBLIC,anon,authenticated;

-- Evidence is private by default; ownership and explicit case access control both apply.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('gi-real-evidence','gi-real-evidence',false,10485760,ARRAY['image/jpeg','image/png','image/webp','application/pdf']::text[])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY gi_real_evidence_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='gi-real-evidence'
  AND EXISTS(SELECT 1 FROM public.gi_real_cases c
             WHERE c.id::text=split_part(name,'/',1))
);
CREATE POLICY gi_real_evidence_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='gi-real-evidence'
  AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'
  AND split_part(name,'/',2)=(SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.gi_real_cases c
    WHERE c.id::text=split_part(name,'/',1)
      AND (
        (SELECT private.gi_role()) IN ('admin','coordinator')
        OR (c.sensitivity='internal' AND private.gi_real_has_access(c.id,true))
      )
  )
);
-- No UPDATE/DELETE on private evidence: append-only in the pilot.

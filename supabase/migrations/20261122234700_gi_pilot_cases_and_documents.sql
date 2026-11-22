CREATE TABLE public.gi_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL UNIQUE REFERENCES public.gi_incidents(id),
  opened_by uuid NOT NULL REFERENCES public.gi_profiles(id),
  opened_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gi_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gi_cases FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gi_cases TO authenticated;
CREATE POLICY gi_cases_staff ON public.gi_cases FOR SELECT TO authenticated
  USING ((SELECT private.gi_role()) IN ('admin','coordinator'));
ALTER TABLE public.gi_tasks ADD COLUMN case_id uuid REFERENCES public.gi_cases(id);
CREATE INDEX gi_tasks_case_idx ON public.gi_tasks(case_id) WHERE case_id IS NOT NULL;

CREATE FUNCTION private.gi_open_case(p_incident uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE found_id uuid;
BEGIN
  IF private.gi_role() NOT IN ('admin','coordinator') OR NOT EXISTS
    (SELECT FROM public.gi_incidents WHERE id=p_incident AND status='submitted' AND is_demo)
    THEN RAISE EXCEPTION 'Peržiūrai pasirinkite pateiktą pranešimą.'; END IF;
  INSERT INTO public.gi_cases(incident_id,opened_by) VALUES(p_incident,auth.uid())
    ON CONFLICT (incident_id) DO NOTHING RETURNING id INTO found_id;
  IF found_id IS NULL THEN SELECT id INTO found_id FROM public.gi_cases WHERE incident_id=p_incident; END IF;
  RETURN found_id;
END $$;
CREATE FUNCTION private.gi_case_task(p_case uuid,p_ref text,p_title text,p_details text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE task uuid;
BEGIN
  IF private.gi_role() NOT IN ('admin','coordinator') OR NOT EXISTS (SELECT FROM public.gi_cases WHERE id=p_case)
    THEN RAISE EXCEPTION 'Atvejis nepasiekiamas.'; END IF;
  task:=private.gi_submit_task('case:'||p_case::text||':'||p_ref,p_title,p_details,'normal',NULL);
  UPDATE public.gi_tasks SET case_id=p_case WHERE id=task AND case_id IS NULL;
  RETURN task;
END $$;

CREATE TABLE public.gi_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL REFERENCES public.gi_profiles(id),
  task_id uuid REFERENCES public.gi_tasks(id), case_id uuid REFERENCES public.gi_cases(id),
  title text NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 160),
  body text NOT NULL CHECK(length(trim(body)) BETWEEN 5 AND 30000),
  phase text NOT NULL CHECK(phase IN ('draft','review','changes','ready')),
  revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.gi_document_versions (
  document_id uuid NOT NULL REFERENCES public.gi_documents(id), revision integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.gi_profiles(id), phase text NOT NULL,
  body text NOT NULL, note text, recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_id,revision)
);
ALTER TABLE public.gi_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gi_document_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gi_documents,public.gi_document_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gi_documents,public.gi_document_versions TO authenticated;
CREATE POLICY gi_documents_reader ON public.gi_documents FOR SELECT TO authenticated USING
  ((SELECT private.gi_role()) IN ('admin','coordinator') OR
    (author_id=(SELECT auth.uid()) AND (SELECT private.gi_can_prepare_documents())));
CREATE POLICY gi_document_versions_reader ON public.gi_document_versions FOR SELECT TO authenticated USING
  (EXISTS(SELECT FROM public.gi_documents d WHERE d.id=document_id));
CREATE INDEX gi_documents_owner_idx ON public.gi_documents(author_id,updated_at DESC);
CREATE INDEX gi_documents_task_idx ON public.gi_documents(task_id);
CREATE INDEX gi_documents_case_idx ON public.gi_documents(case_id);

CREATE FUNCTION private.gi_document_step(p_id uuid,p_revision integer,p_action text,
  p_title text,p_body text,p_note text,p_task uuid,p_case uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.gi_documents%rowtype; staff boolean:=private.gi_role() IN ('admin','coordinator');
  task_case uuid; phase_to text;
BEGIN
  IF auth.uid() IS NULL OR NOT private.gi_can_prepare_documents() OR p_id IS NULL THEN
    RAISE EXCEPTION 'Dokumentų rengimo teisė nesuteikta.'; END IF;
  IF p_action='create' THEN
    IF p_task IS NOT NULL THEN
      SELECT case_id INTO task_case FROM public.gi_tasks WHERE id=p_task AND is_demo AND (staff OR assigned_to=auth.uid());
      IF NOT FOUND THEN RAISE EXCEPTION 'Užduotis nepasiekiama.'; END IF;
    END IF;
    IF p_case IS NOT NULL AND (NOT staff OR NOT EXISTS(SELECT FROM public.gi_cases WHERE id=p_case)
       OR (p_task IS NOT NULL AND task_case IS DISTINCT FROM p_case))
      THEN RAISE EXCEPTION 'Patikrinkite atvejo ryšį su užduotimi.'; END IF;
    INSERT INTO public.gi_documents(id,author_id,task_id,case_id,title,body,phase)
      VALUES(p_id,auth.uid(),p_task,coalesce(p_case,task_case),trim(p_title),trim(p_body),'draft')
      ON CONFLICT (id) DO NOTHING RETURNING * INTO d;
    IF d.id IS NULL THEN
      IF EXISTS (SELECT FROM public.gi_documents WHERE id=p_id AND author_id=auth.uid() AND title=trim(p_title)
        AND body=trim(p_body) AND task_id IS NOT DISTINCT FROM p_task AND case_id IS NOT DISTINCT FROM coalesce(p_case,task_case))
        THEN RETURN p_id; END IF;
      RAISE EXCEPTION 'Dokumento kodas jau naudojamas.';
    END IF;
  ELSE
    SELECT * INTO d FROM public.gi_documents WHERE id=p_id AND (staff OR author_id=auth.uid()) FOR UPDATE;
    IF NOT FOUND OR d.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Atnaujinkite dokumento versiją.'; END IF;
    IF d.author_id=auth.uid() AND d.phase IN ('draft','changes') AND p_action IN ('save','submit') THEN
      phase_to:=CASE p_action WHEN 'submit' THEN 'review' ELSE 'draft' END;
    ELSIF staff AND d.author_id<>auth.uid() AND d.phase='review' AND p_action IN ('return','approve') THEN
      IF p_action='return' AND length(trim(coalesce(p_note,''))) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Įrašykite pastabą.'; END IF;
      phase_to:=CASE p_action WHEN 'return' THEN 'changes' ELSE 'ready' END;
    ELSE RAISE EXCEPTION 'Šio dokumento veiksmas neleidžiamas.'; END IF;
    UPDATE public.gi_documents SET phase=phase_to,revision=revision+1,updated_at=now(),
      body=CASE WHEN p_action IN ('save','submit') THEN trim(p_body) ELSE body END
      WHERE id=p_id RETURNING * INTO d;
  END IF;
  INSERT INTO public.gi_document_versions(document_id,revision,actor_id,phase,body,note)
    VALUES(d.id,d.revision,auth.uid(),d.phase,d.body,left(trim(p_note),1000));
  RETURN d.id;
END $$;

CREATE FUNCTION public.gi_open_case(p_incident uuid) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.gi_open_case(p_incident) $$;
CREATE FUNCTION public.gi_case_task(p_case uuid,p_ref text,p_title text,p_details text) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.gi_case_task(p_case,p_ref,p_title,p_details) $$;
CREATE FUNCTION public.gi_document_step(p_id uuid,p_revision integer,p_action text,p_title text DEFAULT NULL,p_body text DEFAULT NULL,
  p_note text DEFAULT NULL,p_task uuid DEFAULT NULL,p_case uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.gi_document_step(p_id,p_revision,p_action,p_title,p_body,p_note,p_task,p_case) $$;
REVOKE ALL ON FUNCTION private.gi_open_case(uuid),public.gi_open_case(uuid),private.gi_case_task(uuid,text,text,text),
 public.gi_case_task(uuid,text,text,text),private.gi_document_step(uuid,integer,text,text,text,text,uuid,uuid),
 public.gi_document_step(uuid,integer,text,text,text,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_open_case(uuid),public.gi_open_case(uuid),private.gi_case_task(uuid,text,text,text),
 public.gi_case_task(uuid,text,text,text),private.gi_document_step(uuid,integer,text,text,text,text,uuid,uuid),
 public.gi_document_step(uuid,integer,text,text,text,text,uuid,uuid) TO authenticated;

-- Slots enforce a ten-photo limit independently of client-side validation.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('gi-pilot-incident-photos','gi-pilot-incident-photos',false,5242880,ARRAY['image/jpeg','image/png','image/webp']);
CREATE POLICY gi_pilot_photos_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='gi-pilot-incident-photos' AND EXISTS (
    SELECT FROM public.gi_incidents i WHERE i.id::text=split_part(name,'/',1) AND i.is_demo
      AND (i.reporter_id=(SELECT auth.uid()) OR (i.status='submitted' AND (SELECT private.gi_role()) IN ('admin','coordinator')))
  )
);
CREATE POLICY gi_pilot_photos_add ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='gi-pilot-incident-photos' AND name ~ '^[0-9a-f-]{36}/(0[1-9]|10)$'
    AND (SELECT private.gi_role()) IN ('candidate','volunteer','coordinator','admin')
    AND EXISTS (SELECT FROM public.gi_incidents i WHERE i.id::text=split_part(name,'/',1) AND i.is_demo
      AND i.reporter_id=(SELECT auth.uid()) AND i.status='draft')
);
CREATE POLICY gi_pilot_photos_remove ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id='gi-pilot-incident-photos' AND EXISTS (SELECT FROM public.gi_incidents i
    WHERE i.id::text=split_part(name,'/',1) AND i.is_demo AND i.reporter_id=(SELECT auth.uid()) AND i.status='draft')
);
ALTER TABLE public.gi_incidents ADD COLUMN observed_at timestamptz;
-- A client-chosen UUID lets a reporter resume after a lost response without creating another draft.
CREATE FUNCTION private.gi_incident_draft(p_id uuid,p_description text,p_category text,p_event_state text,
  p_lat numeric,p_lon numeric,p_observed timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_id IS NULL OR p_observed IS NULL OR p_observed>now()+interval '10 minutes'
    OR private.gi_role() NOT IN ('candidate','volunteer','coordinator','admin') THEN RAISE EXCEPTION 'Patikrinkite įvykio datą ir prieigą.'; END IF;
  INSERT INTO public.gi_incidents(id,reporter_id,description,category,event_state,latitude,longitude,observed_at)
    VALUES(p_id,auth.uid(),trim(p_description),p_category,p_event_state,p_lat,p_lon,p_observed)
    ON CONFLICT(id) DO UPDATE SET description=excluded.description,category=excluded.category,
      event_state=excluded.event_state,latitude=excluded.latitude,longitude=excluded.longitude,observed_at=excluded.observed_at,updated_at=now()
    WHERE gi_incidents.reporter_id=auth.uid() AND gi_incidents.status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Juodraštis jau pateiktas arba nepasiekiamas. Atnaujinkite sąrašą.'; END IF;
  RETURN p_id;
END $$;
CREATE FUNCTION public.gi_incident_draft(p_id uuid,p_description text,p_category text,p_event_state text,
  p_lat numeric,p_lon numeric,p_observed timestamptz) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.gi_incident_draft(p_id,p_description,p_category,p_event_state,p_lat,p_lon,p_observed)
$$;
REVOKE ALL ON FUNCTION private.gi_incident_draft(uuid,text,text,text,numeric,numeric,timestamptz),
  public.gi_incident_draft(uuid,text,text,text,numeric,numeric,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_incident_draft(uuid,text,text,text,numeric,numeric,timestamptz),
  public.gi_incident_draft(uuid,text,text,text,numeric,numeric,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION private.gi_can_prepare_documents()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.gi_role() IN ('admin','coordinator') OR
    (private.gi_role()='volunteer' AND EXISTS(SELECT FROM public.gi_profiles WHERE id=auth.uid() AND can_prepare_documents))
$$;

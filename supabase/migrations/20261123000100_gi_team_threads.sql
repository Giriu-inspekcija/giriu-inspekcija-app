-- A copied URL is an identifier. Team access requires an explicit staff decision.
ALTER TABLE public.gi_incidents ADD COLUMN team_visible boolean NOT NULL DEFAULT false;
ALTER TABLE public.gi_tasks ADD COLUMN team_visible boolean NOT NULL DEFAULT false;
CREATE POLICY gi_team_incident_read ON public.gi_incidents FOR SELECT TO authenticated
 USING (is_demo AND status='submitted' AND team_visible AND (SELECT private.gi_role())='volunteer');
CREATE POLICY gi_team_task_read ON public.gi_tasks FOR SELECT TO authenticated
 USING (is_demo AND team_visible AND (SELECT private.gi_role())='volunteer');
CREATE POLICY gi_team_task_history ON public.gi_task_events FOR SELECT TO authenticated
 USING ((SELECT private.gi_role())='volunteer' AND EXISTS
  (SELECT FROM public.gi_tasks t WHERE t.id=task_id AND t.is_demo AND t.team_visible));
CREATE POLICY gi_team_case_read ON public.gi_cases FOR SELECT TO authenticated
 USING ((SELECT private.gi_role()) IN ('volunteer','coordinator','admin') AND EXISTS
  (SELECT FROM public.gi_incidents i WHERE i.id=incident_id AND i.status='submitted'));
CREATE POLICY gi_team_original_photos ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='gi-pilot-incident-photos' AND (SELECT private.gi_role())='volunteer' AND EXISTS
  (SELECT FROM public.gi_incidents i WHERE i.id::text=split_part(name,'/',1) AND i.team_visible AND i.status='submitted'));

CREATE TABLE public.gi_thread_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 incident_id uuid REFERENCES public.gi_incidents(id),
 task_id uuid REFERENCES public.gi_tasks(id),
 actor_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.gi_profiles(id),
 actor_name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('note','help','shared','restricted')),
 body text NOT NULL DEFAULT '' CHECK(length(body)<=2000),
 attachment text,
 filename text CHECK(length(filename) BETWEEN 1 AND 180),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(task_id,incident_id)=1),
 CHECK((attachment IS NULL)=(filename IS NULL)),
 CHECK(kind<>'note' OR length(trim(body))>0 OR attachment IS NOT NULL)
);
CREATE INDEX gi_thread_incident ON public.gi_thread_entries(incident_id,created_at DESC,id DESC) WHERE incident_id IS NOT NULL;
CREATE INDEX gi_thread_task ON public.gi_thread_entries(task_id,created_at DESC,id DESC) WHERE task_id IS NOT NULL;
CREATE INDEX gi_thread_actor ON public.gi_thread_entries(actor_id);
CREATE UNIQUE INDEX gi_help_incident ON public.gi_thread_entries(actor_id,incident_id) WHERE kind='help';
CREATE UNIQUE INDEX gi_help_task ON public.gi_thread_entries(actor_id,task_id) WHERE kind='help';
CREATE UNIQUE INDEX gi_thread_file ON public.gi_thread_entries(attachment) WHERE attachment IS NOT NULL;
CREATE FUNCTION private.gi_thread_allowed(p_incident uuid,p_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT private.gi_role() IN ('volunteer','coordinator','admin') AND
  (EXISTS(SELECT FROM public.gi_incidents WHERE id=p_incident AND is_demo AND status='submitted')
   OR EXISTS(SELECT FROM public.gi_tasks WHERE id=p_task AND is_demo))
$$;
CREATE FUNCTION private.gi_thread_author() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 SELECT coalesce(nullif(display_name,''),'GI komandos narys') INTO NEW.actor_name FROM public.gi_profiles WHERE id=NEW.actor_id;
 RETURN NEW;
END $$;
CREATE TRIGGER gi_thread_author BEFORE INSERT ON public.gi_thread_entries FOR EACH ROW EXECUTE FUNCTION private.gi_thread_author();
ALTER TABLE public.gi_thread_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gi_thread_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT, INSERT(id,incident_id,task_id,kind,body,attachment,filename) ON public.gi_thread_entries TO authenticated;
CREATE POLICY gi_thread_read ON public.gi_thread_entries FOR SELECT TO authenticated
 USING (private.gi_thread_allowed(incident_id,task_id));
CREATE POLICY gi_thread_write ON public.gi_thread_entries FOR INSERT TO authenticated
 WITH CHECK (actor_id=(SELECT auth.uid()) AND kind IN ('note','help') AND private.gi_thread_allowed(incident_id,task_id)
  AND (attachment IS NULL OR (attachment ~ '^[0-9a-f-]{36}/(incident|task)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'
    AND split_part(attachment,'/',1)=actor_id::text
    AND split_part(attachment,'/',2)=CASE WHEN incident_id IS NULL THEN 'task' ELSE 'incident' END
    AND split_part(attachment,'/',3)=coalesce(incident_id,task_id)::text
    AND split_part(split_part(attachment,'/',4),'.',1)=id::text
    AND EXISTS(SELECT FROM storage.objects o WHERE o.bucket_id='gi-thread-files' AND o.name=attachment))));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('gi-thread-files','gi-thread-files',false,5242880,ARRAY['image/jpeg','image/png','image/webp','application/pdf']);
CREATE FUNCTION private.gi_thread_file_allowed(path text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE WHEN path ~ '^[0-9a-f-]{36}/(incident|task)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'
 THEN private.gi_thread_allowed(CASE WHEN split_part(path,'/',2)='incident' THEN split_part(path,'/',3)::uuid END,
       CASE WHEN split_part(path,'/',2)='task' THEN split_part(path,'/',3)::uuid END) ELSE false END
$$;
REVOKE ALL ON FUNCTION private.gi_thread_file_allowed(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_thread_file_allowed(text) TO authenticated;
CREATE POLICY gi_thread_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(
 bucket_id='gi-thread-files' AND split_part(name,'/',1)=(SELECT auth.uid())::text AND private.gi_thread_file_allowed(name));
CREATE POLICY gi_thread_download ON storage.objects FOR SELECT TO authenticated USING(
 bucket_id='gi-thread-files' AND ((split_part(name,'/',1)=(SELECT auth.uid())::text AND private.gi_thread_file_allowed(name))
 OR EXISTS(SELECT FROM public.gi_thread_entries e WHERE e.attachment=name)));

CREATE FUNCTION private.gi_set_team_visibility(p_kind text,p_id uuid,p_visible boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR private.gi_role() NOT IN ('admin','coordinator') OR p_visible IS NULL THEN
  RAISE EXCEPTION 'Reikalinga koordinatoriaus teisė.'; END IF;
 IF p_kind='incident' THEN
  UPDATE public.gi_incidents SET team_visible=p_visible WHERE id=p_id AND is_demo AND status='submitted' AND team_visible<>p_visible;
 ELSIF p_kind='task' THEN
  UPDATE public.gi_tasks SET team_visible=p_visible WHERE id=p_id AND is_demo AND team_visible<>p_visible;
 ELSE RAISE EXCEPTION 'Nežinoma kortelė.'; END IF;
 IF FOUND THEN INSERT INTO public.gi_thread_entries(incident_id,task_id,kind) VALUES
  (CASE WHEN p_kind='incident' THEN p_id END,CASE WHEN p_kind='task' THEN p_id END,CASE WHEN p_visible THEN 'shared' ELSE 'restricted' END);
 END IF;
END $$;
CREATE FUNCTION public.gi_set_team_visibility(p_kind text,p_id uuid,p_visible boolean) RETURNS void
 LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.gi_set_team_visibility(p_kind,p_id,p_visible) $$;
REVOKE ALL ON FUNCTION private.gi_thread_author(),private.gi_thread_allowed(uuid,uuid),private.gi_set_team_visibility(text,uuid,boolean),
 public.gi_set_team_visibility(text,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_thread_allowed(uuid,uuid),private.gi_set_team_visibility(text,uuid,boolean),
 public.gi_set_team_visibility(text,uuid,boolean) TO authenticated;

-- Apply reviewer eligibility before paging so ineligible records cannot hide older volunteer work.
CREATE FUNCTION private.gi_review_queue() RETURNS SETOF public.gi_work_logs
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT w.* FROM public.gi_work_logs w WHERE w.review_status='submitted' AND w.volunteer_id<>auth.uid()
 AND private.gi_may_review_time(w.volunteer_id,w.general_activity)
 ORDER BY w.created_at,w.id LIMIT 51
$$;
CREATE FUNCTION public.gi_review_queue() RETURNS SETOF public.gi_work_logs
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM private.gi_review_queue() $$;
REVOKE ALL ON FUNCTION public.gi_review_queue(),private.gi_review_queue() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_review_queue(),private.gi_review_queue() TO authenticated;

-- Synthetic pilot only. Read case context without publishing to all volunteers.
CREATE FUNCTION private.gi_case_context(p_incident uuid,p_case uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND private.gi_role()='volunteer' AND EXISTS (
   SELECT FROM public.gi_incidents i LEFT JOIN public.gi_cases c ON c.incident_id=i.id
   WHERE i.is_demo AND i.status='submitted'
     AND ((p_incident IS NOT NULL AND i.id=p_incident) OR (p_case IS NOT NULL AND c.id=p_case))
     AND (i.reporter_id=auth.uid() OR i.team_visible OR EXISTS (
       SELECT FROM public.gi_tasks t WHERE t.case_id=c.id AND t.is_demo
         AND t.assigned_to=auth.uid() AND t.status IN ('assigned','accepted','in_progress','submitted','returned','approved')
     ))
 )
$$;
REVOKE ALL ON FUNCTION private.gi_case_context(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_case_context(uuid,uuid) TO authenticated;
CREATE POLICY gi_assigned_incident_context ON public.gi_incidents FOR SELECT TO authenticated
 USING (private.gi_case_context(id,NULL));
CREATE POLICY gi_assigned_incident_photos ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='gi-pilot-incident-photos' AND EXISTS (
  SELECT FROM public.gi_incidents i WHERE i.id::text=split_part(name,'/',1)
    AND private.gi_case_context(i.id,NULL)
 ));
CREATE POLICY gi_linked_case_documents ON public.gi_documents FOR SELECT TO authenticated
 USING (case_id IS NOT NULL AND private.gi_case_context(NULL,case_id));
-- Existing case and thread policies reference incident RLS; no extra edit rights.

CREATE FUNCTION private.gi_finish_incident(p_id uuid,p_description text,p_category text,p_event_state text,
 p_lat numeric,p_lon numeric,p_destination text,p_volunteer uuid,p_details text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role_name text:=coalesce(private.gi_role(),'pending');
 v_id uuid; v_case uuid; v_task uuid;
BEGIN
 IF actor IS NULL OR p_id IS NULL OR role_name NOT IN ('candidate','volunteer','coordinator','admin')
    OR p_destination IS NULL OR p_destination NOT IN ('review','team','assigned') THEN
   RAISE EXCEPTION 'Netinkamas įvykio pateikimas'; END IF;
 IF p_destination='team' AND role_name NOT IN ('volunteer','coordinator','admin') THEN
   RAISE EXCEPTION 'Skelbti komandai gali patvirtintas savanoris'; END IF;
 IF p_destination='assigned' THEN
   IF role_name NOT IN ('coordinator','admin') OR p_volunteer IS NULL
      OR length(trim(coalesce(p_details,''))) NOT BETWEEN 5 AND 6000
      OR NOT EXISTS(SELECT FROM public.gi_profiles p JOIN auth.users u ON u.id=p.id
                    WHERE p.id=p_volunteer AND p.role IN ('volunteer','coordinator','admin')
                    AND u.email_confirmed_at IS NOT NULL) THEN
     RAISE EXCEPTION 'Patikrinkite vykdytoją ir užduoties aprašymą'; END IF;
 ELSE
   IF p_volunteer IS NOT NULL THEN RAISE EXCEPTION 'Netinkamas vykdytojas'; END IF;
 END IF;
 IF NOT EXISTS(SELECT FROM public.gi_incidents WHERE id=p_id AND reporter_id=actor AND status='draft' AND is_demo) THEN
   RAISE EXCEPTION 'Pasirinkite savo demonstracinį juodraštį'; END IF;
 v_id:=private.gi_save_incident(p_id,p_description,p_category,p_event_state,p_lat,p_lon,true);
 IF p_destination='team' THEN
   UPDATE public.gi_incidents SET team_visible=true WHERE id=v_id;
   INSERT INTO public.gi_thread_entries(incident_id,kind) VALUES(v_id,'shared');
 ELSIF p_destination='assigned' THEN
   v_case:=private.gi_open_case(v_id);
   v_task:=private.gi_case_task(v_case,'initial-review','Patikrinti įvykį',p_details);
   PERFORM public.gi_assign_proposed_task(v_task,p_volunteer);
 END IF;
 RETURN v_id;
END $$;
CREATE FUNCTION public.gi_finish_incident(p_id uuid,p_description text,p_category text,p_event_state text,
 p_lat numeric,p_lon numeric,p_destination text,p_volunteer uuid,p_details text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.gi_finish_incident(p_id,p_description,p_category,p_event_state,p_lat,p_lon,p_destination,p_volunteer,p_details)
$$;
REVOKE ALL ON FUNCTION private.gi_finish_incident(uuid,text,text,text,numeric,numeric,text,uuid,text),
 public.gi_finish_incident(uuid,text,text,text,numeric,numeric,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_finish_incident(uuid,text,text,text,numeric,numeric,text,uuid,text),
 public.gi_finish_incident(uuid,text,text,text,numeric,numeric,text,uuid,text) TO authenticated;

CREATE FUNCTION public.gi_delegate_incident(p_incident uuid,p_ref text,p_details text,p_volunteer uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_case uuid; v_task uuid; v_current public.gi_tasks%rowtype;
BEGIN
 IF auth.uid() IS NULL OR coalesce(private.gi_role(),'pending') NOT IN ('admin','coordinator')
    OR p_volunteer IS NULL THEN RAISE EXCEPTION 'Reikia koordinatoriaus teisių'; END IF;
 v_case:=public.gi_open_case(p_incident);
 v_task:=public.gi_case_task(v_case,p_ref,'Patikrinti įvykį',p_details);
 SELECT * INTO v_current FROM public.gi_tasks WHERE id=v_task;
 IF v_current.status='proposed' THEN PERFORM public.gi_assign_proposed_task(v_task,p_volunteer);
 ELSIF v_current.assigned_to IS DISTINCT FROM p_volunteer THEN RAISE EXCEPTION 'Užduotis jau paskirta kitam vykdytojui';
 END IF;
 RETURN v_task;
END $$;
REVOKE ALL ON FUNCTION public.gi_delegate_incident(uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_delegate_incident(uuid,text,text,uuid) TO authenticated;

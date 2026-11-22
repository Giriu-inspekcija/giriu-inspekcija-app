-- Girių inspekcija / PILOT ONLY. Candidate onboarding, separate experience ranks,
-- and explicit document-drafting permissions. All existing tasks remain synthetic.
ALTER TABLE public.gi_profiles
  ADD COLUMN IF NOT EXISTS membership_intent text NOT NULL DEFAULT 'unspecified'
     CHECK (membership_intent IN ('unspecified','new_candidate','existing_volunteer')),
  ADD COLUMN IF NOT EXISTS preferred_activity text NOT NULL DEFAULT 'other'
     CHECK (preferred_activity IN ('field','advocacy','gis','communications','other')),
  ADD COLUMN IF NOT EXISTS region_label text
     CHECK (region_label IS NULL OR char_length(region_label)<=100),
  ADD COLUMN IF NOT EXISTS volunteer_rank text
     CHECK (volunteer_rank IS NULL OR volunteer_rank IN
       ('pradedantysis','patyres','vyriausias','regiono_vadas')),
  ADD COLUMN IF NOT EXISTS can_prepare_documents boolean NOT NULL DEFAULT false;
ALTER TABLE public.gi_profiles DROP CONSTRAINT gi_profiles_role_check;
ALTER TABLE public.gi_profiles ADD CONSTRAINT gi_profiles_role_check
 CHECK (role IN ('pending','candidate','volunteer','coordinator','admin'));
ALTER TABLE public.gi_tasks
  ADD COLUMN IF NOT EXISTS task_kind text NOT NULL DEFAULT 'other'
    CHECK (task_kind IN ('field_visit','training','advocacy','documentation','other')),
  ADD COLUMN IF NOT EXISTS candidate_safe boolean NOT NULL DEFAULT false;
ALTER TABLE public.gi_tasks ADD CONSTRAINT gi_tasks_candidate_safe_kind_check
 CHECK (NOT candidate_safe OR task_kind IN ('field_visit','training','other'));
CREATE INDEX IF NOT EXISTS gi_tasks_candidate_safe_assignee_idx
 ON public.gi_tasks(assigned_to,created_at DESC,id DESC) WHERE candidate_safe;

-- This is self-reported *intent*, never authorization: unsafe raw metadata cannot set role/rank.
CREATE OR REPLACE FUNCTION public.gi_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
 INSERT INTO public.gi_profiles(id,display_name,role,membership_intent,preferred_activity,region_label)
 VALUES(
   new.id,
   left(coalesce(new.raw_user_meta_data->>'full_name',''),100),
   'pending',
   CASE WHEN new.raw_user_meta_data->>'membership_intent' IN ('new_candidate','existing_volunteer')
     THEN new.raw_user_meta_data->>'membership_intent' ELSE 'unspecified' END,
   CASE WHEN new.raw_user_meta_data->>'preferred_activity' IN ('field','advocacy','gis','communications','other')
     THEN new.raw_user_meta_data->>'preferred_activity' ELSE 'other' END,
   nullif(left(btrim(coalesce(new.raw_user_meta_data->>'region_label','')),100),'')
 ) ON CONFLICT (id) DO NOTHING;
 RETURN new;
END
$$;

-- Candidates can only see explicitly approved, assigned tasks with harmless demo content.
DROP POLICY IF EXISTS "gi_tasks_staff_or_assignee" ON public.gi_tasks;
CREATE POLICY "gi_tasks_staff_or_assignee" ON public.gi_tasks FOR SELECT TO authenticated
USING (
  (select private.gi_role()) IN ('coordinator','admin')
  OR (assigned_to=(select auth.uid()) AND
    ((select private.gi_role())='volunteer'
      OR ( (select private.gi_role())='candidate' AND candidate_safe )))
);
DROP POLICY IF EXISTS "gi_events_visible_task" ON public.gi_task_events;
CREATE POLICY "gi_events_visible_task" ON public.gi_task_events FOR SELECT TO authenticated
USING (
  EXISTS(SELECT 1 FROM public.gi_tasks t WHERE t.id=task_id
    AND ((select private.gi_role()) IN ('coordinator','admin')
      OR (t.assigned_to=(select auth.uid()) AND
       ((select private.gi_role())='volunteer'
        OR ((select private.gi_role())='candidate' AND t.candidate_safe)))))
);
DROP POLICY IF EXISTS "gi_feedback_insert_own" ON public.gi_feedback;
CREATE POLICY "gi_feedback_insert_own" ON public.gi_feedback FOR INSERT TO authenticated
WITH CHECK (
  reporter_id=(select auth.uid()) AND
  (select private.gi_role()) IN ('candidate','volunteer','coordinator','admin')
);

-- Approved staff mark only pooled, synthetic non-sensitive tasks candidate-safe.
CREATE OR REPLACE FUNCTION private.gi_set_candidate_task(p_id uuid,p_safe boolean,p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_status text;
BEGIN
 IF (select private.gi_role()) NOT IN ('coordinator','admin') OR auth.uid() IS NULL THEN
   RAISE EXCEPTION 'GI staff permission required'; END IF;
 IF p_kind NOT IN ('field_visit','training','advocacy','documentation','other')
   OR (p_safe AND p_kind NOT IN ('field_visit','training','other'))
   OR p_safe IS NULL THEN RAISE EXCEPTION 'Invalid candidate task category'; END IF;
 SELECT status INTO v_status FROM public.gi_tasks WHERE id=p_id AND is_demo FOR UPDATE;
 IF v_status IS NULL OR v_status NOT IN ('pool','proposed') THEN
   RAISE EXCEPTION 'Only unassigned proposed/pool tasks can be marked'; END IF;
 UPDATE public.gi_tasks SET candidate_safe=p_safe,task_kind=p_kind,updated_at=now()
 WHERE id=p_id AND assigned_to IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Task must be unassigned'; END IF;
 INSERT INTO public.gi_task_events(task_id,actor_id,action,note)
 VALUES (p_id,auth.uid(),'candidate_task_flag',p_kind || ' safe=' || p_safe::text);
END
$$;
REVOKE ALL ON FUNCTION private.gi_set_candidate_task(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_set_candidate_task(uuid,boolean,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_set_candidate_task(p_id uuid,p_safe boolean,p_kind text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.gi_set_candidate_task(p_id,p_safe,p_kind) $$;
REVOKE ALL ON FUNCTION public.gi_set_candidate_task(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_set_candidate_task(uuid,boolean,text) TO authenticated;

-- New candidate or verified existing volunteer: human review mandatory.
CREATE OR REPLACE FUNCTION private.gi_approve_candidate(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_role text;
BEGIN
 IF coalesce((select private.gi_role()),'pending') NOT IN ('coordinator','admin')
   OR p_user IS NULL OR p_user=auth.uid() THEN
   RAISE EXCEPTION 'GI staff permission required'; END IF;
 SELECT role INTO v_role FROM public.gi_profiles WHERE id=p_user FOR UPDATE;
 IF v_role IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'Only pending may become candidate'; END IF;
 UPDATE public.gi_profiles SET role='candidate',
   volunteer_rank='pradedantysis',can_prepare_documents=false WHERE id=p_user;
 INSERT INTO public.gi_role_events(actor_id,target_id,former_role,new_role)
 VALUES(auth.uid(),p_user,'pending','candidate');
END
$$;
REVOKE ALL ON FUNCTION private.gi_approve_candidate(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_approve_candidate(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_approve_candidate(p_user uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.gi_approve_candidate(p_user) $$;
REVOKE ALL ON FUNCTION public.gi_approve_candidate(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_approve_candidate(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.gi_promote_candidate(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_role text;
BEGIN
 IF coalesce((select private.gi_role()),'pending') NOT IN ('coordinator','admin')
   OR p_user IS NULL OR p_user=auth.uid() THEN
   RAISE EXCEPTION 'GI staff permission required'; END IF;
 SELECT role INTO v_role FROM public.gi_profiles WHERE id=p_user FOR UPDATE;
 IF v_role IS DISTINCT FROM 'candidate' THEN RAISE EXCEPTION 'Only candidates can be promoted'; END IF;
 UPDATE public.gi_profiles SET role='volunteer',can_prepare_documents=false WHERE id=p_user;
 INSERT INTO public.gi_role_events(actor_id,target_id,former_role,new_role)
 VALUES(auth.uid(),p_user,'candidate','volunteer');
END
$$;
REVOKE ALL ON FUNCTION private.gi_promote_candidate(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_promote_candidate(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_promote_candidate(p_user uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.gi_promote_candidate(p_user) $$;
REVOKE ALL ON FUNCTION public.gi_promote_candidate(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_promote_candidate(uuid) TO authenticated;

-- Approve existing self-claimed volunteer after human verification; beginner default.
CREATE OR REPLACE FUNCTION private.gi_approve_volunteer(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_old text;
BEGIN
 IF coalesce((select private.gi_role()),'pending') NOT IN ('coordinator','admin')
   OR p_user IS NULL OR p_user=auth.uid() THEN
   RAISE EXCEPTION 'Coordinator permission required'; END IF;
 SELECT role INTO v_old FROM public.gi_profiles WHERE id=p_user FOR UPDATE;
 IF v_old IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'Only pending can be approved'; END IF;
 UPDATE public.gi_profiles SET role='volunteer',
   volunteer_rank=coalesce(volunteer_rank,'pradedantysis') WHERE id=p_user;
 INSERT INTO public.gi_role_events(actor_id,target_id,former_role,new_role)
 VALUES(auth.uid(),p_user,'pending','volunteer');
END
$$;

-- Master and coordinator both assign; candidate task eligibility enforced server-side.
CREATE OR REPLACE FUNCTION private.gi_assign_task(p_id uuid,p_volunteer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_target_role text; v_task public.gi_tasks%rowtype;
BEGIN
 IF coalesce((select private.gi_role()),'pending') NOT IN ('coordinator','admin') THEN
   RAISE EXCEPTION 'GI staff permission required'; END IF;
 SELECT role INTO v_target_role FROM public.gi_profiles WHERE id=p_volunteer;
 IF coalesce(v_target_role,'pending') NOT IN ('candidate','volunteer','coordinator','admin') THEN
   RAISE EXCEPTION 'Target not approved'; END IF;
 SELECT * INTO v_task FROM public.gi_tasks WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v_task.status NOT IN ('pool','assigned') THEN
   RAISE EXCEPTION 'Task not assignable'; END IF;
 IF v_target_role='candidate' AND
    (NOT v_task.candidate_safe OR v_task.task_kind NOT IN ('field_visit','training','other')) THEN
   RAISE EXCEPTION 'Candidate is not allowed to receive this task';
 END IF;
 UPDATE public.gi_tasks SET assigned_to=p_volunteer,status='assigned',updated_at=now() WHERE id=p_id;
 INSERT INTO public.gi_task_events(task_id,actor_id,action,note)
 VALUES(p_id,auth.uid(),'assign','Synthetic task assigned by GI staff');
END
$$;

-- Self-performed candidate actions limited to assigned and marked candidate-safe tasks.
CREATE OR REPLACE FUNCTION private.gi_task_action(p_id uuid,p_action text,p_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_task public.gi_tasks%rowtype; v_role text; v_new text;
BEGIN
 v_role:=coalesce((select private.gi_role()),'pending');
 IF v_role='pending' THEN RAISE EXCEPTION 'GI permission denied'; END IF;
 SELECT * INTO v_task FROM public.gi_tasks WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
 IF v_role='candidate' AND
   (NOT v_task.candidate_safe OR v_task.assigned_to IS DISTINCT FROM auth.uid()
     OR v_task.task_kind NOT IN ('field_visit','training','other')) THEN
   RAISE EXCEPTION 'Candidate task permission denied';
 END IF;
 IF p_action='publish' AND v_role IN ('coordinator','admin') AND v_task.status='proposed' THEN
   v_new:='pool';
 ELSIF p_action='accept' AND v_task.assigned_to=auth.uid() AND v_task.status='assigned' THEN
   v_new:='accepted';
 ELSIF p_action='start' AND v_task.assigned_to=auth.uid() AND v_task.status IN ('accepted','returned') THEN
   v_new:='in_progress';
 ELSIF p_action='submit' AND v_task.assigned_to=auth.uid() AND v_task.status='in_progress'
   AND char_length(btrim(coalesce(p_note,''))) BETWEEN 10 AND 6000 THEN
   v_new:='submitted';
 ELSIF p_action='approve' AND v_role IN ('coordinator','admin') AND v_task.status='submitted' THEN
   v_new:='approved';
 ELSIF p_action='return' AND v_role IN ('coordinator','admin') AND v_task.status='submitted'
   AND char_length(btrim(coalesce(p_note,''))) BETWEEN 3 AND 2000 THEN
   v_new:='returned';
 ELSE RAISE EXCEPTION 'Invalid GI role or task transition'; END IF;
 UPDATE public.gi_tasks SET status=v_new,updated_at=now(),
   result_text=CASE WHEN p_action='submit' THEN btrim(p_note) ELSE result_text END,
   feedback_text=CASE WHEN p_action='return' THEN btrim(p_note) ELSE feedback_text END
 WHERE id=p_id;
 INSERT INTO public.gi_task_events(task_id,actor_id,action,note)
 VALUES(p_id,auth.uid(),p_action,left(p_note,2000));
 RETURN v_new;
END
$$;

CREATE OR REPLACE FUNCTION private.gi_log_minutes(p_id uuid,p_minutes integer,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid; v_role text;
BEGIN
 v_role:=coalesce((select private.gi_role()),'pending');
 IF v_role NOT IN ('candidate','volunteer','coordinator','admin')
   OR NOT EXISTS (SELECT 1 FROM public.gi_tasks WHERE id=p_id AND assigned_to=auth.uid()
     AND status IN ('accepted','in_progress','submitted','returned','approved')
     AND (v_role<>'candidate' OR candidate_safe))
   OR p_minutes NOT BETWEEN 1 AND 720 OR char_length(coalesce(p_note,''))>1000 THEN
   RAISE EXCEPTION 'Invalid GI time entry';
 END IF;
 INSERT INTO public.gi_work_logs(task_id,volunteer_id,minutes,note)
 VALUES(p_id,auth.uid(),p_minutes,p_note) RETURNING id INTO v_id;
 RETURN v_id;
END
$$;

-- A separate experience rank is recognition, NOT a permission grant.
CREATE OR REPLACE FUNCTION private.gi_set_volunteer_rank(p_user uuid,p_rank text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_role text;
BEGIN
 IF (select private.gi_role()) <> 'admin' OR p_user=auth.uid()
   OR p_rank NOT IN ('pradedantysis','patyres','vyriausias','regiono_vadas') THEN
   RAISE EXCEPTION 'Only master can set volunteer ranks'; END IF;
 SELECT role INTO v_role FROM public.gi_profiles WHERE id=p_user FOR UPDATE;
 IF v_role NOT IN ('candidate','volunteer') THEN
   RAISE EXCEPTION 'Approved volunteer or candidate required'; END IF;
 IF v_role='candidate' AND p_rank<>'pradedantysis' THEN
   RAISE EXCEPTION 'A candidate must first become a volunteer'; END IF;
 UPDATE public.gi_profiles SET volunteer_rank=p_rank WHERE id=p_user;
 INSERT INTO public.gi_role_events(actor_id,target_id,former_role,new_role)
 VALUES(auth.uid(),p_user,'rank_changed',p_rank);
END
$$;
REVOKE ALL ON FUNCTION private.gi_set_volunteer_rank(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_set_volunteer_rank(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_set_volunteer_rank(p_user uuid,p_rank text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.gi_set_volunteer_rank(p_user,p_rank) $$;
REVOKE ALL ON FUNCTION public.gi_set_volunteer_rank(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_set_volunteer_rank(uuid,text) TO authenticated;

-- Restricted future document drafting permission (does not expose Google Drive or OpenAI).
CREATE OR REPLACE FUNCTION private.gi_can_prepare_documents()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT coalesce((SELECT p.role IN ('admin','coordinator')
       OR (p.role='volunteer' AND p.can_prepare_documents)
       FROM public.gi_profiles p WHERE p.id=auth.uid()),false)
$$;
REVOKE ALL ON FUNCTION private.gi_can_prepare_documents() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_can_prepare_documents() TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_can_prepare_documents()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.gi_can_prepare_documents() $$;
REVOKE ALL ON FUNCTION public.gi_can_prepare_documents() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_can_prepare_documents() TO authenticated;

CREATE OR REPLACE FUNCTION private.gi_set_document_permission(p_user uuid,p_allowed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_role text;
BEGIN
 IF (select private.gi_role()) <> 'admin' OR p_user=auth.uid() OR p_allowed IS NULL THEN
   RAISE EXCEPTION 'Only master can grant document drafting'; END IF;
 SELECT role INTO v_role FROM public.gi_profiles WHERE id=p_user FOR UPDATE;
 IF v_role IS DISTINCT FROM 'volunteer' THEN
   RAISE EXCEPTION 'Only confirmed volunteers can receive this permission'; END IF;
 UPDATE public.gi_profiles SET can_prepare_documents=p_allowed WHERE id=p_user;
 INSERT INTO public.gi_role_events(actor_id,target_id,former_role,new_role)
 VALUES(auth.uid(),p_user,'draft_permission',CASE WHEN p_allowed THEN 'enabled' ELSE 'disabled' END);
END
$$;
REVOKE ALL ON FUNCTION private.gi_set_document_permission(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_set_document_permission(uuid,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_set_document_permission(p_user uuid,p_allowed boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.gi_set_document_permission(p_user,p_allowed) $$;
REVOKE ALL ON FUNCTION public.gi_set_document_permission(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_set_document_permission(uuid,boolean) TO authenticated;

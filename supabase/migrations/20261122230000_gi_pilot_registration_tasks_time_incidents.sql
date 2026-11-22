-- GI synthetic pilot – audited registration decisions, task cycle, time confirmation and demo observations.
-- Never connects production case registers. No destructive auth.users operations.
ALTER TABLE public.gi_profiles
  ADD COLUMN IF NOT EXISTS registration_state text NOT NULL DEFAULT 'active'
  CONSTRAINT gi_profiles_registration_state_check CHECK (registration_state IN ('active','withdrawn','rejected'));

CREATE TABLE IF NOT EXISTS public.gi_registration_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES public.gi_profiles(id) ON DELETE SET NULL,
  target_id uuid REFERENCES public.gi_profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK(action IN ('withdraw','reject','restore')),
  previous_state text NOT NULL,
  new_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gi_registration_events_target_idx ON public.gi_registration_events(target_id,created_at DESC);
ALTER TABLE public.gi_registration_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gi_registration_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gi_registration_events TO authenticated;
CREATE POLICY gi_registration_events_view ON public.gi_registration_events
  FOR SELECT TO authenticated
  USING (target_id=(SELECT auth.uid()) OR (SELECT private.gi_role()) IN ('coordinator','admin'));

-- A withdrawn/rejected pending person cannot be approved even by another staff UI/RPC.
CREATE OR REPLACE FUNCTION private.gi_guard_registration_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $$
BEGIN
  IF OLD.role='pending' AND NEW.role<>'pending' AND OLD.registration_state<>'active' THEN
    RAISE EXCEPTION 'Registration is not active; restore before approval';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS gi_guard_registration_approval ON public.gi_profiles;
CREATE TRIGGER gi_guard_registration_approval
  BEFORE UPDATE OF role ON public.gi_profiles
  FOR EACH ROW EXECUTE FUNCTION private.gi_guard_registration_approval();
REVOKE ALL ON FUNCTION private.gi_guard_registration_approval() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.gi_review_registration(p_user uuid,p_action text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_prior text; v_role text; v_new text;
BEGIN
  IF auth.uid() IS NULL OR p_user IS NULL
    OR p_action NOT IN ('withdraw','reject','restore') THEN
    RAISE EXCEPTION 'Invalid registration review';
  END IF;
  IF p_action='withdraw' THEN
    IF p_user<>auth.uid() THEN RAISE EXCEPTION 'Only owner may withdraw'; END IF;
  ELSIF (SELECT private.gi_role()) NOT IN ('coordinator','admin') OR p_user=auth.uid() THEN
    RAISE EXCEPTION 'Staff verification required';
  END IF;
  SELECT registration_state,role INTO v_prior,v_role FROM public.gi_profiles WHERE id=p_user FOR UPDATE;
  IF NOT FOUND OR v_role<>'pending' THEN
    RAISE EXCEPTION 'Only pending registrations can be reviewed';
  END IF;
  IF (p_action='withdraw' AND v_prior<>'active')
     OR (p_action='reject' AND v_prior<>'active')
     OR (p_action='restore' AND v_prior='active') THEN
    RAISE EXCEPTION 'Registration is not in a reviewable state';
  END IF;
  v_new:=CASE p_action WHEN 'withdraw' THEN 'withdrawn'
                       WHEN 'reject' THEN 'rejected' ELSE 'active' END;
  UPDATE public.gi_profiles SET registration_state=v_new WHERE id=p_user;
  INSERT INTO public.gi_registration_events(actor_id,target_id,action,previous_state,new_state)
  VALUES(auth.uid(),p_user,p_action,v_prior,v_new);
  RETURN v_new;
END
$$;
REVOKE ALL ON FUNCTION private.gi_review_registration(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_review_registration(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_review_registration(p_user uuid,p_action text)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.gi_review_registration(p_user,p_action) $$;
REVOKE ALL ON FUNCTION public.gi_review_registration(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_review_registration(uuid,text) TO authenticated;

-- Staff-only verified email lookup to distinguish duplicate names and invalid registrations.
CREATE OR REPLACE FUNCTION private.gi_member_emails(p_ids uuid[])
RETURNS TABLE(user_id uuid,email text,verified boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF (SELECT private.gi_role()) NOT IN ('coordinator','admin') THEN
    RAISE EXCEPTION 'Staff permission required';
  END IF;
  IF p_ids IS NULL OR coalesce(array_length(p_ids,1),0)>100 THEN
    RAISE EXCEPTION 'Invalid member lookup';
  END IF;
  RETURN QUERY
    SELECT u.id,u.email,(u.email_confirmed_at IS NOT NULL)
    FROM auth.users u JOIN public.gi_profiles p ON p.id=u.id
    WHERE u.id=ANY(p_ids);
END
$$;
REVOKE ALL ON FUNCTION private.gi_member_emails(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_member_emails(uuid[]) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_member_emails(p_ids uuid[])
RETURNS TABLE(user_id uuid,email text,verified boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT * FROM private.gi_member_emails(p_ids) $$;
REVOKE ALL ON FUNCTION public.gi_member_emails(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_member_emails(uuid[]) TO authenticated;

-- Volunteers see unassigned synthetic pool work, candidates only explicitly safe pool work.
DROP POLICY IF EXISTS "gi_tasks_staff_or_assignee" ON public.gi_tasks;
CREATE POLICY "gi_tasks_staff_or_assignee" ON public.gi_tasks
  FOR SELECT TO authenticated USING (
    (SELECT private.gi_role()) IN ('coordinator','admin')
    OR (assigned_to=(SELECT auth.uid()) AND
      ((SELECT private.gi_role())='volunteer' OR
       ((SELECT private.gi_role())='candidate' AND candidate_safe)))
    OR (assigned_to IS NULL AND status='pool' AND is_demo AND
      ((SELECT private.gi_role())='volunteer'
       OR ((SELECT private.gi_role())='candidate' AND candidate_safe
          AND task_kind IN ('field_visit','training','other'))))
  );

-- All actions are atomic, role-checked, and logged. Declines return the task to the pool.
CREATE OR REPLACE FUNCTION private.gi_task_action(p_id uuid,p_action text,p_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_task public.gi_tasks%rowtype; v_role text; v_new text; v_assignee uuid;
BEGIN
 v_role:=coalesce((SELECT private.gi_role()),'pending');
 IF v_role='pending' THEN RAISE EXCEPTION 'GI permission denied'; END IF;
 SELECT * INTO v_task FROM public.gi_tasks WHERE id=p_id AND is_demo FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
 IF v_role='candidate' AND (
   NOT v_task.candidate_safe OR v_task.task_kind NOT IN ('field_visit','training','other')
   OR (v_task.assigned_to IS DISTINCT FROM auth.uid()
       AND NOT(p_action='claim' AND v_task.status='pool' AND v_task.assigned_to IS NULL))
 ) THEN RAISE EXCEPTION 'Candidate task permission denied'; END IF;
 v_assignee:=v_task.assigned_to;
 IF p_action='publish' AND v_role IN ('coordinator','admin') AND v_task.status='proposed' THEN
   v_new:='pool';
 ELSIF p_action='claim' AND v_role IN ('candidate','volunteer','coordinator','admin')
   AND v_task.status='pool' AND v_task.assigned_to IS NULL THEN
   v_new:='assigned';v_assignee:=auth.uid();
 ELSIF p_action='decline' AND v_task.assigned_to=auth.uid() AND v_task.status='assigned'
   AND char_length(btrim(coalesce(p_note,''))) BETWEEN 3 AND 2000 THEN
   v_new:='pool';v_assignee:=NULL;
 ELSIF p_action='unassign' AND v_role IN ('coordinator','admin') AND v_task.status='assigned' THEN
   v_new:='pool';v_assignee:=NULL;
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
 UPDATE public.gi_tasks SET status=v_new,assigned_to=v_assignee,updated_at=now(),
   result_text=CASE WHEN p_action='submit' THEN btrim(p_note) ELSE result_text END,
   feedback_text=CASE WHEN p_action='return' THEN btrim(p_note) ELSE feedback_text END
 WHERE id=p_id;
 INSERT INTO public.gi_task_events(task_id,actor_id,action,note)
 VALUES(p_id,auth.uid(),p_action,left(p_note,2000));
 RETURN v_new;
END
$$;
REVOKE ALL ON FUNCTION private.gi_task_action(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_task_action(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.gi_set_task_due(p_id uuid,p_due timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF (SELECT private.gi_role()) NOT IN ('coordinator','admin') THEN
    RAISE EXCEPTION 'Staff permission required';
  END IF;
  IF p_due IS NOT NULL AND (p_due<now()-interval '1 day' OR p_due>now()+interval '3 years') THEN
    RAISE EXCEPTION 'Invalid due date'; END IF;
  UPDATE public.gi_tasks SET due_at=p_due,updated_at=now()
    WHERE id=p_id AND is_demo AND status IN ('proposed','pool','assigned','accepted','in_progress','returned');
  IF NOT FOUND THEN RAISE EXCEPTION 'Task cannot be scheduled'; END IF;
  INSERT INTO public.gi_task_events(task_id,actor_id,action,note)
  VALUES(p_id,auth.uid(),'set_due',coalesce(p_due::text,'clear'));
END
$$;
REVOKE ALL ON FUNCTION private.gi_set_task_due(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_set_task_due(uuid,timestamptz) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_set_task_due(p_id uuid,p_due timestamptz)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.gi_set_task_due(p_id,p_due) $$;
REVOKE ALL ON FUNCTION public.gi_set_task_due(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_set_task_due(uuid,timestamptz) TO authenticated;

-- Existing logs remain submitted until a coordinator reviews them.
ALTER TABLE public.gi_work_logs
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'submitted'
    CONSTRAINT gi_work_logs_review_status_check CHECK(review_status IN ('submitted','approved','returned')),
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.gi_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text CHECK(review_note IS NULL OR char_length(review_note)<=1000);
CREATE INDEX IF NOT EXISTS gi_work_logs_review_status_idx ON public.gi_work_logs(review_status,created_at);
CREATE OR REPLACE FUNCTION private.gi_review_work_log(p_id uuid,p_action text,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_log public.gi_work_logs%rowtype;v_new text;
BEGIN
 IF (SELECT private.gi_role()) NOT IN ('coordinator','admin') THEN
   RAISE EXCEPTION 'Staff permission required'; END IF;
 IF p_action NOT IN ('approve','return') THEN RAISE EXCEPTION 'Invalid review action'; END IF;
 SELECT * INTO v_log FROM public.gi_work_logs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v_log.review_status NOT IN ('submitted','returned') THEN
   RAISE EXCEPTION 'Time log unavailable for review';END IF;
 IF v_log.volunteer_id=auth.uid() THEN RAISE EXCEPTION 'Self approval forbidden';END IF;
 IF p_action='return' AND char_length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 1000 THEN
   RAISE EXCEPTION 'Reason required'; END IF;
 v_new:=CASE p_action WHEN 'approve' THEN 'approved' ELSE 'returned' END;
 UPDATE public.gi_work_logs SET review_status=v_new,reviewed_by=auth.uid(),
  reviewed_at=now(),review_note=NULLIF(btrim(coalesce(p_note,'')),'') WHERE id=p_id;
 INSERT INTO public.gi_task_events(task_id,actor_id,action,note)
 VALUES(v_log.task_id,auth.uid(),'time_'||p_action,left(p_note,1000));
END
$$;
REVOKE ALL ON FUNCTION private.gi_review_work_log(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_review_work_log(uuid,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_review_work_log(p_id uuid,p_action text,p_note text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.gi_review_work_log(p_id,p_action,p_note) $$;
REVOKE ALL ON FUNCTION public.gi_review_work_log(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_review_work_log(uuid,text,text) TO authenticated;

-- Demo observations: text/GPS only; do not upload real photos or sensitive coordinates.
CREATE TABLE IF NOT EXISTS public.gi_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.gi_profiles(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'other'
    CHECK(category IN ('cutting','timber_truck','pollution','tree_damage','waste','other','unknown')),
  description text NOT NULL CHECK(char_length(btrim(description)) BETWEEN 5 AND 3000),
  event_state text NOT NULL DEFAULT 'unknown'
    CHECK(event_state IN ('ongoing','past','needs_check','unknown')),
  latitude numeric CHECK(latitude BETWEEN -90 AND 90),
  longitude numeric CHECK(longitude BETWEEN -180 AND 180),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted')),
  is_demo boolean NOT NULL DEFAULT true CHECK(is_demo=true),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gi_incidents_both_coords CHECK((latitude IS NULL)=(longitude IS NULL))
);
CREATE INDEX IF NOT EXISTS gi_incidents_reporter_idx ON public.gi_incidents(reporter_id,created_at DESC);
ALTER TABLE public.gi_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gi_incidents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gi_incidents TO authenticated;
CREATE POLICY gi_incidents_owner_staff ON public.gi_incidents
 FOR SELECT TO authenticated USING (reporter_id=(SELECT auth.uid())
   OR (SELECT private.gi_role()) IN ('coordinator','admin'));

CREATE OR REPLACE FUNCTION private.gi_save_incident(
 p_id uuid,p_description text,p_category text,p_event_state text,
 p_lat numeric,p_lon numeric,p_submit boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_id uuid;v_role text;
BEGIN
 v_role:=coalesce((SELECT private.gi_role()),'pending');
 IF v_role NOT IN ('candidate','volunteer','coordinator','admin') THEN
   RAISE EXCEPTION 'Approved pilot participant required'; END IF;
 IF char_length(btrim(coalesce(p_description,''))) NOT BETWEEN 5 AND 3000
  OR p_category NOT IN ('cutting','timber_truck','pollution','tree_damage','waste','other','unknown')
  OR p_event_state NOT IN ('ongoing','past','needs_check','unknown')
  OR (p_lat IS NULL)<>(p_lon IS NULL) OR p_lat NOT BETWEEN -90 AND 90
  OR p_lon NOT BETWEEN -180 AND 180 OR p_submit IS NULL THEN
   RAISE EXCEPTION 'Invalid demonstration observation'; END IF;
 IF p_id IS NULL THEN
   INSERT INTO public.gi_incidents(reporter_id,description,category,event_state,
     latitude,longitude,status)
   VALUES(auth.uid(),btrim(p_description),p_category,p_event_state,p_lat,p_lon,
     CASE WHEN p_submit THEN 'submitted' ELSE 'draft' END) RETURNING id INTO v_id;
 ELSE
   UPDATE public.gi_incidents SET description=btrim(p_description),
     category=p_category,event_state=p_event_state,latitude=p_lat,longitude=p_lon,
     status=CASE WHEN p_submit THEN 'submitted' ELSE 'draft' END,updated_at=now()
   WHERE id=p_id AND reporter_id=auth.uid() AND status='draft'
   RETURNING id INTO v_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Only own drafts may be edited'; END IF;
 END IF;
 RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION private.gi_save_incident(uuid,text,text,text,numeric,numeric,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_save_incident(uuid,text,text,text,numeric,numeric,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_save_incident(
 p_id uuid,p_description text,p_category text,p_event_state text,
 p_lat numeric,p_lon numeric,p_submit boolean
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.gi_save_incident(p_id,p_description,p_category,p_event_state,p_lat,p_lon,p_submit) $$;
REVOKE ALL ON FUNCTION public.gi_save_incident(uuid,text,text,text,numeric,numeric,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_save_incident(uuid,text,text,text,numeric,numeric,boolean) TO authenticated;
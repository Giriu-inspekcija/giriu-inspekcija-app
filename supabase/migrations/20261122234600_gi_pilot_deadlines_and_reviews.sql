-- Reviewer appointments are bound privately to verified Auth UUIDs by an operator.
CREATE TABLE private.gi_time_reviewers (
  appointment text PRIMARY KEY CHECK (appointment IN ('chief','coordinator')),
  user_id uuid UNIQUE NOT NULL REFERENCES public.gi_profiles(id) ON DELETE CASCADE
);
REVOKE ALL ON private.gi_time_reviewers FROM PUBLIC,anon,authenticated;

-- Historical records without a project classification require independent review.
ALTER TABLE public.gi_work_logs
  ADD COLUMN work_date date,
  ADD COLUMN project_label text CHECK (char_length(project_label) BETWEEN 2 AND 120),
  ADD COLUMN general_activity boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT gi_general_without_project CHECK (NOT general_activity OR project_label IS NULL);
CREATE TABLE private.gi_time_review_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  log_id uuid NOT NULL REFERENCES public.gi_work_logs(id),
  actor_id uuid NOT NULL REFERENCES public.gi_profiles(id),
  action text NOT NULL CHECK (action IN ('approve','return')),
  self_review boolean NOT NULL, note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.gi_time_review_events FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.gi_may_review_time(p_owner uuid,p_general boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.gi_time_reviewers r
    JOIN public.gi_profiles reviewer ON reviewer.id=r.user_id
    JOIN auth.users u ON u.id=reviewer.id AND u.email_confirmed_at IS NOT NULL
    JOIN public.gi_profiles owner ON owner.id=p_owner
    WHERE reviewer.id=(SELECT auth.uid()) AND reviewer.registration_state='active'
      AND ((r.appointment='chief' AND reviewer.role='admin' AND (reviewer.id<>owner.id OR p_general))
        OR (r.appointment='coordinator' AND reviewer.role='coordinator' AND reviewer.id<>owner.id
          AND owner.role IN ('candidate','volunteer')))
  )
$$;
REVOKE ALL ON FUNCTION private.gi_may_review_time(uuid,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.gi_reviewable_logs(p_ids uuid[])
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT w.id FROM public.gi_work_logs w WHERE w.id=ANY(p_ids) AND cardinality(p_ids)<=150
    AND w.review_status='submitted' AND private.gi_may_review_time(w.volunteer_id,w.general_activity)
$$;
REVOKE ALL ON FUNCTION private.gi_reviewable_logs(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_reviewable_logs(uuid[]) TO authenticated;
CREATE FUNCTION public.gi_reviewable_logs(p_ids uuid[]) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM private.gi_reviewable_logs(p_ids) $$;
REVOKE ALL ON FUNCTION public.gi_reviewable_logs(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_reviewable_logs(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION private.gi_review_work_log(p_id uuid,p_action text,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.gi_work_logs%rowtype;
BEGIN
  SELECT * INTO w FROM public.gi_work_logs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR w.review_status<>'submitted' OR NOT private.gi_may_review_time(w.volunteer_id,w.general_activity)
    THEN RAISE EXCEPTION 'Šio laiko įrašo tvirtinti negalite.'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve','return') OR
    (p_action='return' AND length(trim(coalesce(p_note,''))) NOT BETWEEN 3 AND 1000)
    THEN RAISE EXCEPTION 'Pasirinkite veiksmą ir nurodykite grąžinimo priežastį.'; END IF;
  UPDATE public.gi_work_logs SET review_status=CASE p_action WHEN 'approve' THEN 'approved' ELSE 'returned' END,
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(left(p_note,1000)),'') WHERE id=p_id;
  INSERT INTO private.gi_time_review_events(log_id,actor_id,action,self_review,note)
    VALUES(p_id,auth.uid(),p_action,auth.uid()=w.volunteer_id,left(p_note,1000));
  IF w.task_id IS NOT NULL THEN
    INSERT INTO public.gi_task_events(task_id,actor_id,action,note)
      VALUES(w.task_id,auth.uid(),'time_'||p_action,left(p_note,1000));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.gi_approve_result_with_time(p_task_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.gi_tasks%rowtype; log_id uuid; n integer:=0;
BEGIN
  SELECT * INTO t FROM public.gi_tasks WHERE id=p_task_id AND is_demo FOR UPDATE;
  IF NOT FOUND OR t.status<>'submitted' OR t.assigned_to IS NULL OR t.assigned_to=auth.uid()
     OR coalesce(private.gi_role(),'pending') NOT IN ('admin','coordinator')
    THEN RAISE EXCEPTION 'Rezultatą turi peržiūrėti kitas koordinatorius.'; END IF;
  FOR log_id IN SELECT w.id FROM public.gi_work_logs w WHERE w.task_id=t.id AND w.review_status='submitted'
      AND private.gi_may_review_time(w.volunteer_id,w.general_activity) ORDER BY w.id FOR UPDATE LOOP
    PERFORM private.gi_review_work_log(log_id,'approve',NULL);
    n:=n+1;
  END LOOP;
  PERFORM private.gi_task_action(t.id,'approve',NULL);
  RETURN n;
END $$;

CREATE FUNCTION private.gi_record_dated_time(p_task_id uuid,p_minutes integer,p_activity_title text,p_note text,
  p_date date,p_project text,p_general boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE new_id uuid; project text:=nullif(trim(p_project),'');
BEGIN
  IF p_date IS NULL OR p_date>(now() AT TIME ZONE 'Europe/Vilnius')::date
    OR p_general IS NULL OR (p_general AND project IS NOT NULL) OR (NOT p_general AND project IS NULL)
    OR length(trim(coalesce(p_note,''))) NOT BETWEEN 1 AND 1000
    THEN RAISE EXCEPTION 'Patikrinkite darbo datą, projektą ir aprašymą.'; END IF;
  new_id:=private.gi_record_volunteer_time(p_task_id,p_minutes,p_activity_title,p_note);
  UPDATE public.gi_work_logs SET work_date=p_date,project_label=project,general_activity=p_general WHERE id=new_id;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION private.gi_record_dated_time(uuid,integer,text,text,date,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_record_dated_time(uuid,integer,text,text,date,text,boolean) TO authenticated;
CREATE FUNCTION public.gi_record_dated_time(p_task_id uuid,p_minutes integer,p_activity_title text,p_note text,
  p_date date,p_project text,p_general boolean)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.gi_record_dated_time(p_task_id,p_minutes,p_activity_title,p_note,p_date,p_project,p_general)
$$;
REVOKE ALL ON FUNCTION public.gi_record_dated_time(uuid,integer,text,text,date,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_record_dated_time(uuid,integer,text,text,date,text,boolean) TO authenticated;

CREATE FUNCTION public.gi_search_tasks_page(p_before_created_at timestamptz,p_before_id uuid,p_limit integer,
  p_filter text,p_search text,p_owner uuid,p_due_filter text)
RETURNS SETOF public.gi_tasks LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT t.* FROM public.gi_tasks t
  WHERE (p_before_created_at IS NULL OR (t.created_at,t.id)<(p_before_created_at,p_before_id))
    AND (p_owner IS NULL OR t.assigned_to=p_owner)
    AND (coalesce(p_search,'')='' OR strpos(lower(t.title||' '||t.details),lower(left(trim(p_search),100)))>0)
    AND (p_filter='all' OR (p_filter='pool' AND t.status IN ('pool','proposed'))
      OR (p_filter='assigned' AND t.status IN ('assigned','accepted','in_progress','returned'))
      OR t.status=p_filter)
    AND (p_due_filter='all' OR (p_due_filter='none' AND t.due_at IS NULL)
      OR (t.status NOT IN ('approved','submitted') AND ((p_due_filter='overdue' AND t.due_at<now())
        OR (p_due_filter='week' AND t.due_at BETWEEN now() AND now()+interval '7 days'))))
  ORDER BY t.created_at DESC,t.id DESC LIMIT least(greatest(coalesce(p_limit,51),1),100)
$$;
REVOKE ALL ON FUNCTION public.gi_search_tasks_page(timestamptz,uuid,integer,text,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_search_tasks_page(timestamptz,uuid,integer,text,text,uuid,text) TO authenticated;

-- Atomically create a proposal (including its deadline) or return the existing proposal on retry.
CREATE FUNCTION private.gi_submit_task(p_source_ref text,p_title text,p_details text,p_priority text,p_due timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE task uuid; old public.gi_tasks%rowtype;
BEGIN
  IF coalesce(private.gi_role(),'pending') NOT IN ('admin','coordinator') OR
    p_source_ref IS NULL OR length(trim(p_source_ref)) NOT BETWEEN 3 AND 160 OR p_priority IS NULL
    THEN RAISE EXCEPTION 'Reikia koordinatoriaus teisių ir pastovaus šaltinio kodo.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(trim(p_source_ref),0));
  SELECT * INTO old FROM public.gi_tasks WHERE source_ref=trim(p_source_ref);
  IF FOUND THEN
    IF old.title IS DISTINCT FROM trim(p_title) OR old.details IS DISTINCT FROM trim(p_details) OR old.priority IS DISTINCT FROM p_priority
      THEN RAISE EXCEPTION 'Šaltinio kodas jau panaudotas kitai užduočiai.'; END IF;
    RETURN old.id;
  END IF;
  task:=private.gi_create_proposal(p_title,p_details,p_priority,trim(p_source_ref));
  IF p_due IS NOT NULL THEN PERFORM private.gi_set_task_due(task,p_due); END IF;
  INSERT INTO public.gi_task_events(task_id,actor_id,action) VALUES(task,auth.uid(),'propose');
  RETURN task;
END $$;
REVOKE ALL ON FUNCTION private.gi_submit_task(text,text,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_submit_task(text,text,text,text,timestamptz) TO authenticated;
CREATE FUNCTION public.gi_submit_task(p_source_ref text,p_title text,p_details text,p_priority text DEFAULT 'normal',p_due timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.gi_submit_task(p_source_ref,p_title,p_details,p_priority,p_due)
$$;
REVOKE ALL ON FUNCTION public.gi_submit_task(text,text,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_submit_task(text,text,text,text,timestamptz) TO authenticated;

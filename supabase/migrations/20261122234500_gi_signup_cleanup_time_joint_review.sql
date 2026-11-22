-- GI pilot: clean up unconfirmed erroneous signups without losing active volunteer records.
-- Staff approval and task approval are always independently checked by the database.
CREATE OR REPLACE FUNCTION private.gi_guard_registration_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $$
BEGIN
  IF OLD.role='pending' AND NEW.role<>'pending' AND OLD.registration_state<>'active' THEN
    RAISE EXCEPTION 'Registration is not active; restore before approval';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role AND NEW.role IN ('candidate','volunteer','coordinator','admin')
     AND NOT EXISTS(
       SELECT 1 FROM auth.users u WHERE u.id=NEW.id AND u.email_confirmed_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Confirm email before granting GI role';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION private.gi_guard_registration_approval() FROM PUBLIC,anon,authenticated;

CREATE TABLE IF NOT EXISTS private.gi_purged_signup_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purged_user_id uuid NOT NULL,
  actor_id uuid,
  reason text NOT NULL DEFAULT 'Unverified rejected or withdrawn signup',
  purged_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.gi_purged_signup_audit FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.gi_purge_invalid_signup(p_user uuid,p_expected_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_user auth.users%ROWTYPE; v_profile public.gi_profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR (SELECT private.gi_role()) <> 'admin' OR p_user IS NULL
    OR p_user=auth.uid() OR p_expected_email IS NULL THEN
    RAISE EXCEPTION 'Only GI administrator may purge an unverified signup';
  END IF;
  SELECT * INTO v_user FROM auth.users WHERE id=p_user FOR UPDATE;
  SELECT * INTO v_profile FROM public.gi_profiles WHERE id=p_user FOR UPDATE;
  IF NOT FOUND OR v_user.id IS NULL
    OR lower(v_user.email)<>lower(btrim(p_expected_email))
    OR v_user.email_confirmed_at IS NOT NULL
    OR v_user.created_at>now()-interval '10 minutes'
    OR v_profile.role<>'pending'
    OR v_profile.registration_state NOT IN ('rejected','withdrawn') THEN
    RAISE EXCEPTION 'Signup is not eligible for safe purge';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.identities i WHERE i.user_id=p_user AND i.provider <> 'email')
    OR EXISTS(SELECT 1 FROM public.gi_tasks t WHERE t.assigned_to=p_user OR t.created_by=p_user)
    OR EXISTS(SELECT 1 FROM public.gi_task_events e WHERE e.actor_id=p_user)
    OR EXISTS(SELECT 1 FROM public.gi_work_logs l WHERE l.volunteer_id=p_user OR l.reviewed_by=p_user)
    OR EXISTS(SELECT 1 FROM public.gi_feedback f WHERE f.reporter_id=p_user)
    OR EXISTS(SELECT 1 FROM public.gi_incidents i WHERE i.reporter_id=p_user) THEN
    RAISE EXCEPTION 'Signup has activity; do not purge via the typo-cleanup flow';
  END IF;
  INSERT INTO private.gi_purged_signup_audit(purged_user_id,actor_id)
  VALUES(p_user,auth.uid());
  DELETE FROM auth.users WHERE id=p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signup could not be deleted'; END IF;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION private.gi_purge_invalid_signup(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_purge_invalid_signup(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_purge_invalid_signup(p_user uuid,p_expected_email text)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.gi_purge_invalid_signup(p_user,p_expected_email) $$;
REVOKE ALL ON FUNCTION public.gi_purge_invalid_signup(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_purge_invalid_signup(uuid,text) TO authenticated;

-- Logs with no prior task remain individually reviewable and auditable.
ALTER TABLE public.gi_work_logs ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE public.gi_work_logs
  ADD COLUMN IF NOT EXISTS activity_title text;
ALTER TABLE public.gi_work_logs
  ADD CONSTRAINT gi_work_logs_unlinked_title_check
  CHECK (
    task_id IS NOT NULL OR
    (activity_title IS NOT NULL AND char_length(btrim(activity_title)) BETWEEN 5 AND 160)
  );
CREATE INDEX IF NOT EXISTS gi_work_logs_owner_recent_idx
  ON public.gi_work_logs(volunteer_id,created_at DESC);

CREATE OR REPLACE FUNCTION private.gi_record_volunteer_time(
  p_task_id uuid,p_minutes integer,p_activity_title text,p_note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_role text;v_id uuid;
BEGIN
  v_role:=coalesce((SELECT private.gi_role()),'pending');
  IF v_role NOT IN ('candidate','volunteer','coordinator','admin')
    OR NOT EXISTS(SELECT 1 FROM public.gi_profiles p WHERE p.id=auth.uid()
      AND p.registration_state='active')
    OR p_minutes NOT BETWEEN 1 AND 720
    OR char_length(coalesce(p_note,''))>1000 THEN
    RAISE EXCEPTION 'Invalid volunteer time entry';
  END IF;
  IF p_task_id IS NULL THEN
    IF char_length(btrim(coalesce(p_activity_title,''))) NOT BETWEEN 5 AND 160 THEN
      RAISE EXCEPTION 'Describe the activity before saving standalone hours';
    END IF;
  ELSIF NOT EXISTS(
    SELECT 1 FROM public.gi_tasks t WHERE t.id=p_task_id AND t.is_demo
      AND t.assigned_to=auth.uid()
      AND t.status IN ('assigned','accepted','in_progress','submitted','returned','approved')
      AND (v_role<>'candidate' OR t.candidate_safe)
  ) THEN
    RAISE EXCEPTION 'Only your own synthetic assigned task may receive time entries';
  END IF;
  INSERT INTO public.gi_work_logs(task_id,volunteer_id,minutes,note,activity_title)
  VALUES(p_task_id,auth.uid(),p_minutes,NULLIF(btrim(coalesce(p_note,'')),''),
    CASE WHEN p_task_id IS NULL THEN btrim(p_activity_title) ELSE NULL END)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION private.gi_record_volunteer_time(uuid,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_record_volunteer_time(uuid,integer,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_record_volunteer_time(
  p_task_id uuid,p_minutes integer,p_activity_title text,p_note text
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.gi_record_volunteer_time(p_task_id,p_minutes,p_activity_title,p_note) $$;
REVOKE ALL ON FUNCTION public.gi_record_volunteer_time(uuid,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_record_volunteer_time(uuid,integer,text,text) TO authenticated;

-- One-click review of both task result and all submitted time entries attached to that task.
CREATE OR REPLACE FUNCTION private.gi_approve_result_with_time(p_task_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_task public.gi_tasks%ROWTYPE;v_count integer;
BEGIN
  IF (SELECT private.gi_role()) NOT IN ('coordinator','admin') THEN
    RAISE EXCEPTION 'Coordinator permission required';
  END IF;
  SELECT * INTO v_task FROM public.gi_tasks WHERE id=p_task_id AND is_demo FOR UPDATE;
  IF NOT FOUND OR v_task.status<>'submitted'
    OR v_task.assigned_to IS NULL OR v_task.assigned_to=auth.uid() THEN
    RAISE EXCEPTION 'Only another coordinator may approve a submitted result';
  END IF;
  UPDATE public.gi_tasks SET status='approved',updated_at=now()
  WHERE id=p_task_id;
  UPDATE public.gi_work_logs SET review_status='approved',
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=NULL
  WHERE task_id=p_task_id AND volunteer_id=v_task.assigned_to
    AND review_status='submitted';
  GET DIAGNOSTICS v_count=ROW_COUNT;
  INSERT INTO public.gi_task_events(task_id,actor_id,action,note)
    VALUES(p_task_id,auth.uid(),'approve',
      'Task result approved together with '||v_count||' submitted time entries');
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION private.gi_approve_result_with_time(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_approve_result_with_time(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.gi_approve_result_with_time(p_task_id uuid)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.gi_approve_result_with_time(p_task_id) $$;
REVOKE ALL ON FUNCTION public.gi_approve_result_with_time(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_approve_result_with_time(uuid) TO authenticated;
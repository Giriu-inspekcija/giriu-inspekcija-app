-- Require distinct GI reviewer of task results; no self-approval or self-return.
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
 ELSIF p_action='approve' AND v_role IN ('coordinator','admin') AND v_task.status='submitted' AND v_task.assigned_to IS DISTINCT FROM auth.uid() THEN
   v_new:='approved';
 ELSIF p_action='return' AND v_role IN ('coordinator','admin') AND v_task.status='submitted' AND v_task.assigned_to IS DISTINCT FROM auth.uid()
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

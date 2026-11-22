CREATE TABLE public.gi_feedback_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint bytea NOT NULL UNIQUE,
  example_id uuid NOT NULL REFERENCES public.gi_feedback(id),
  reports integer NOT NULL DEFAULT 1, last_report_at timestamptz NOT NULL,
  task_id uuid REFERENCES public.gi_tasks(id), resolved_at timestamptz,
  resolution text, reviewer_id uuid REFERENCES public.gi_profiles(id)
);
ALTER TABLE public.gi_feedback_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gi_feedback_review FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gi_feedback_review TO authenticated;
CREATE POLICY gi_feedback_review_staff ON public.gi_feedback_review FOR SELECT TO authenticated
 USING ((SELECT private.gi_role()) IN ('admin','coordinator'));
CREATE FUNCTION private.gi_feedback_key(category text,message text)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT sha256(convert_to(category || '|' || lower(regexp_replace(trim(message),'[[:space:]]+',' ','g')),'UTF8'))
$$;
REVOKE ALL ON FUNCTION private.gi_feedback_key(text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.gi_queue_feedback() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.gi_feedback_review(fingerprint,example_id,last_report_at)
  VALUES(private.gi_feedback_key(NEW.category,NEW.message),NEW.id,NEW.created_at)
  ON CONFLICT(fingerprint) DO UPDATE SET reports=gi_feedback_review.reports+1,last_report_at=greatest(gi_feedback_review.last_report_at,excluded.last_report_at);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.gi_queue_feedback() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER gi_queue_feedback AFTER INSERT ON public.gi_feedback FOR EACH ROW EXECUTE FUNCTION private.gi_queue_feedback();
INSERT INTO public.gi_feedback_review(fingerprint,example_id,reports,last_report_at)
SELECT private.gi_feedback_key(category,message),(array_agg(id ORDER BY created_at,id))[1],count(*),max(created_at)
 FROM public.gi_feedback GROUP BY private.gi_feedback_key(category,message);

CREATE FUNCTION private.gi_review_feedback_group(p_id uuid,p_action text,p_title text,p_note text,p_priority text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.gi_feedback_review%rowtype; task uuid;
BEGIN
  IF private.gi_role() NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'Reikia koordinatoriaus teisių.'; END IF;
  SELECT * INTO g FROM public.gi_feedback_review WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pastaba nerasta.'; END IF;
  IF p_action='task' THEN
    IF g.task_id IS NOT NULL THEN RETURN g.task_id; END IF;
    IF g.resolved_at IS NOT NULL THEN RAISE EXCEPTION 'Pastaba jau išnagrinėta.'; END IF;
    task:=private.gi_submit_task('feedback:'||p_id::text,p_title,p_note,p_priority,NULL);
    UPDATE public.gi_feedback_review SET task_id=task,reviewer_id=auth.uid() WHERE id=p_id;
    RETURN task;
  ELSIF p_action='resolve' AND length(trim(coalesce(p_note,''))) BETWEEN 3 AND 1200 THEN
    IF g.resolved_at IS NULL THEN
      UPDATE public.gi_feedback_review SET resolved_at=now(),resolution=trim(p_note),reviewer_id=auth.uid() WHERE id=p_id;
    END IF;
    RETURN g.task_id;
  END IF;
  RAISE EXCEPTION 'Užrašykite sprendimą.';
END $$;
CREATE FUNCTION public.gi_review_feedback_group(p_id uuid,p_action text,p_title text,p_note text,p_priority text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.gi_review_feedback_group(p_id,p_action,p_title,p_note,p_priority)
$$;
REVOKE ALL ON FUNCTION public.gi_review_feedback_group(uuid,text,text,text,text),private.gi_review_feedback_group(uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_review_feedback_group(uuid,text,text,text,text),private.gi_review_feedback_group(uuid,text,text,text,text) TO authenticated;

CREATE FUNCTION public.gi_deadline_counts()
RETURNS TABLE(overdue bigint,upcoming bigint) LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT count(*) FILTER (WHERE due_at<now()),count(*) FILTER (WHERE due_at BETWEEN now() AND now()+interval '7 days')
 FROM public.gi_tasks WHERE assigned_to=(SELECT auth.uid()) AND status IN ('assigned','accepted','in_progress','returned')
$$;
REVOKE ALL ON FUNCTION public.gi_deadline_counts() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gi_deadline_counts() TO authenticated;

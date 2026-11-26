-- GI project defaults, staff administration; no retroactive update of existing hours.
CREATE TABLE private.gi_time_project_defaults (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES public.gi_profiles(id) ON DELETE CASCADE,
 project_label text NOT NULL CHECK(char_length(btrim(project_label)) BETWEEN 2 AND 120),
 starts_on date NOT NULL, ends_on date CHECK(ends_on IS NULL OR ends_on >= starts_on),
 closed_on date, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 closed_by uuid, closed_at timestamptz
);
CREATE UNIQUE INDEX gi_time_project_one_current ON private.gi_time_project_defaults(user_id) WHERE closed_at IS NULL;
CREATE INDEX gi_time_project_dates ON private.gi_time_project_defaults(user_id,starts_on);
ALTER TABLE private.gi_time_project_defaults ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.gi_time_project_defaults FROM PUBLIC,anon,authenticated;
CREATE TABLE private.gi_time_project_requests (
 log_id uuid PRIMARY KEY REFERENCES public.gi_work_logs(id) ON DELETE CASCADE,
 requested_project text
);
ALTER TABLE private.gi_time_project_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.gi_time_project_requests FROM PUBLIC,anon,authenticated;
CREATE TABLE private.gi_time_project_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 log_id uuid NOT NULL REFERENCES public.gi_work_logs(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL, old_project text, new_project text,
 changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.gi_time_project_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.gi_time_project_changes FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.gi_project_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.gi_profiles p JOIN auth.users u ON u.id=p.id
 WHERE p.id=auth.uid() AND p.role='admin' AND p.registration_state='active' AND u.email_confirmed_at IS NOT NULL)
$$;
CREATE FUNCTION private.gi_default_time_project(p_user uuid,p_date date) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT d.project_label FROM private.gi_time_project_defaults d
 JOIN public.gi_profiles p ON p.id=d.user_id
 WHERE d.user_id=p_user AND p.role IN ('candidate','volunteer','coordinator')
 AND p.registration_state='active' AND d.starts_on<=p_date
 AND (d.ends_on IS NULL OR p_date<=d.ends_on) AND (d.closed_on IS NULL OR p_date<d.closed_on)
 ORDER BY d.starts_on DESC,d.id DESC LIMIT 1
$$;
CREATE FUNCTION private.gi_set_time_project_default(p_user uuid,p_project text,p_start date,p_end date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE label text:=nullif(btrim(p_project),''); today date:=(now() AT TIME ZONE 'Europe/Vilnius')::date; current_start date;
BEGIN
 IF NOT private.gi_project_admin() OR p_user=auth.uid() THEN RAISE EXCEPTION 'Tik administratorius gali priskirti projektą kitam komandos nariui.'; END IF;
 PERFORM 1 FROM public.gi_profiles WHERE id=p_user AND role IN ('candidate','volunteer','coordinator') AND registration_state='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Narys neaktyvus.'; END IF;
 IF label IS NOT NULL AND (char_length(label) NOT BETWEEN 2 AND 120 OR p_start IS NULL OR (p_end IS NOT NULL AND p_end<p_start)) THEN RAISE EXCEPTION 'Patikrinkite projektą ir datas.'; END IF;
 SELECT starts_on INTO current_start FROM private.gi_time_project_defaults WHERE user_id=p_user AND closed_at IS NULL;
 -- Existing historical periods remain untouched. A replacement begins on its own date,
 -- but never before today or before a previously closed period.
 IF label IS NOT NULL AND EXISTS(SELECT 1 FROM private.gi_time_project_defaults WHERE user_id=p_user)
 AND p_start<today THEN RAISE EXCEPTION 'Keičiant projektą pradžia negali būti praeityje.'; END IF;
 IF label IS NOT NULL AND EXISTS(SELECT 1 FROM private.gi_time_project_defaults WHERE user_id=p_user AND closed_on>p_start) THEN
 RAISE EXCEPTION 'Pradžia persidengia su ankstesniu priskyrimu.'; END IF;
 IF label IS NULL THEN
  UPDATE private.gi_time_project_defaults SET closed_on=today,closed_at=now(),closed_by=auth.uid()
  WHERE user_id=p_user AND (closed_on IS NULL OR closed_on>today);
 ELSE
  UPDATE private.gi_time_project_defaults SET closed_on=p_start,closed_at=now(),closed_by=auth.uid()
  WHERE user_id=p_user AND closed_at IS NULL;
 END IF;
 IF label IS NOT NULL THEN
 INSERT INTO private.gi_time_project_defaults(user_id,project_label,starts_on,ends_on,created_by)
 VALUES(p_user,label,p_start,p_end,auth.uid());
 END IF;
END $$;
CREATE FUNCTION private.gi_get_time_project_defaults() RETURNS TABLE(user_id uuid,project_label text,starts_on date,ends_on date) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT private.gi_project_admin() THEN RAISE EXCEPTION 'Tik administratoriui.'; END IF;
 RETURN QUERY SELECT d.user_id,d.project_label,d.starts_on,d.ends_on FROM private.gi_time_project_defaults d WHERE d.closed_at IS NULL;
END $$;
CREATE FUNCTION private.gi_override_time_project(p_id uuid,p_project text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.gi_work_logs%rowtype; label text:=nullif(btrim(p_project),'');
BEGIN
 IF NOT private.gi_project_admin() THEN RAISE EXCEPTION 'Tik administratoriui.'; END IF;
 SELECT * INTO w FROM public.gi_work_logs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR w.volunteer_id=auth.uid() OR w.review_status<>'submitted' OR NOT private.gi_may_review_time(w.volunteer_id,w.general_activity)
 THEN RAISE EXCEPTION 'Galima keisti tik kitų narių dar nepatvirtintą įrašą.'; END IF;
 IF label IS NOT NULL AND char_length(label) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Netinkamas projektas.'; END IF;
 IF w.project_label IS NOT DISTINCT FROM label AND w.general_activity=(label IS NULL) THEN RETURN; END IF;
 INSERT INTO private.gi_time_project_requests(log_id,requested_project) VALUES(w.id,w.project_label) ON CONFLICT DO NOTHING;
 UPDATE public.gi_work_logs SET project_label=label,general_activity=(label IS NULL) WHERE id=w.id;
 INSERT INTO private.gi_time_project_changes(log_id,actor_id,old_project,new_project) VALUES(w.id,auth.uid(),w.project_label,label);
END $$;
-- Legacy task-time paths are covered at insertion. Dated time explicitly recalculates
-- by the selected work date, not insertion date.
CREATE FUNCTION private.gi_time_project_on_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE label text;
BEGIN
 label:=private.gi_default_time_project(NEW.volunteer_id,coalesce(NEW.work_date,(now() AT TIME ZONE 'Europe/Vilnius')::date));
 IF label IS NOT NULL THEN NEW.project_label:=label; NEW.general_activity:=false; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gi_time_project_on_insert BEFORE INSERT ON public.gi_work_logs FOR EACH ROW EXECUTE FUNCTION private.gi_time_project_on_insert();
CREATE OR REPLACE FUNCTION private.gi_record_dated_time(p_task_id uuid,p_minutes integer,p_activity_title text,p_note text,p_date date,p_project text,p_general boolean,p_request uuid DEFAULT NULL::uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE new_id uuid; project text:=nullif(trim(p_project),''); requested text; previous public.gi_work_logs%rowtype;
BEGIN
 IF p_date IS NULL OR p_date>(now() AT TIME ZONE 'Europe/Vilnius')::date OR p_general IS NULL
 OR (p_general AND project IS NOT NULL) OR (NOT p_general AND project IS NULL)
 OR length(trim(coalesce(p_note,''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Patikrinkite darbo datą, projektą ir aprašymą.'; END IF;
 IF p_request IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  SELECT * INTO previous FROM public.gi_work_logs WHERE volunteer_id=auth.uid() AND request_id=p_request;
  IF FOUND THEN
   SELECT requested_project INTO requested FROM private.gi_time_project_requests WHERE log_id=previous.id;
   IF NOT FOUND THEN requested:=previous.project_label; END IF;
   IF previous.task_id IS DISTINCT FROM p_task_id OR previous.minutes IS DISTINCT FROM p_minutes
   OR previous.work_date IS DISTINCT FROM p_date OR requested IS DISTINCT FROM project
   OR previous.note IS DISTINCT FROM trim(p_note)
   OR (p_task_id IS NULL AND previous.activity_title IS DISTINCT FROM trim(p_activity_title))
   THEN RAISE EXCEPTION 'Pateikimo kodas jau panaudotas kitam įrašui.'; END IF;
   RETURN previous.id;
  END IF;
 END IF;
 requested:=project;
 -- Non-admins cannot manufacture a project label. Old clients can retry an
 -- existing submission, but new attribution is solely from the staff default.
 IF NOT private.gi_project_admin() THEN
  project:=private.gi_default_time_project(auth.uid(),p_date);
  IF requested IS NOT NULL AND requested IS DISTINCT FROM project THEN
   RAISE EXCEPTION 'Projektą priskiria administratorius. Atnaujinkite programėlę ir pateikite valandas be projekto.';
  END IF;
 ELSE
  project:=coalesce(private.gi_default_time_project(auth.uid(),p_date),project);
 END IF;
 new_id:=private.gi_record_volunteer_time(p_task_id,p_minutes,p_activity_title,p_note);
 UPDATE public.gi_work_logs SET work_date=p_date,project_label=project,general_activity=(project IS NULL),request_id=p_request WHERE id=new_id;
 INSERT INTO private.gi_time_project_requests(log_id,requested_project) VALUES(new_id,requested);
 RETURN new_id;
END $$;
CREATE FUNCTION public.gi_set_time_project_default(p_user uuid,p_project text,p_start date,p_end date) RETURNS void LANGUAGE sql SET search_path='' AS $$ SELECT private.gi_set_time_project_default(p_user,p_project,p_start,p_end) $$;
CREATE FUNCTION public.gi_get_time_project_defaults() RETURNS TABLE(user_id uuid,project_label text,starts_on date,ends_on date) LANGUAGE sql STABLE SET search_path='' AS $$ SELECT * FROM private.gi_get_time_project_defaults() $$;
CREATE FUNCTION public.gi_override_time_project(p_id uuid,p_project text) RETURNS void LANGUAGE sql SET search_path='' AS $$ SELECT private.gi_override_time_project(p_id,p_project) $$;
REVOKE ALL ON FUNCTION private.gi_project_admin(),private.gi_default_time_project(uuid,date),private.gi_time_project_on_insert() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.gi_set_time_project_default(uuid,text,date,date),private.gi_get_time_project_defaults(),private.gi_override_time_project(uuid,text),public.gi_set_time_project_default(uuid,text,date,date),public.gi_get_time_project_defaults(),public.gi_override_time_project(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.gi_set_time_project_default(uuid,text,date,date),private.gi_get_time_project_defaults(),private.gi_override_time_project(uuid,text),public.gi_set_time_project_default(uuid,text,date,date),public.gi_get_time_project_defaults(),public.gi_override_time_project(uuid,text) TO authenticated;

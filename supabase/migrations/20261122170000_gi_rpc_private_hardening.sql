-- Move privileged business logic out of exposed public API schema.
-- Public RPCs remain callable through non-privileged SECURITY INVOKER wrappers.
-- Every private function retains its own authorization checks and pinned search_path.
ALTER FUNCTION public.gi_create_proposal(text,text,text,text) SET SCHEMA private;
ALTER FUNCTION public.gi_assign_task(uuid,uuid) SET SCHEMA private;
ALTER FUNCTION public.gi_task_action(uuid,text,text) SET SCHEMA private;
ALTER FUNCTION public.gi_log_minutes(uuid,integer,text) SET SCHEMA private;
ALTER FUNCTION public.gi_set_user_role(uuid,text) SET SCHEMA private;

CREATE FUNCTION public.gi_create_proposal(p_title text,p_details text,p_priority text DEFAULT 'normal',p_source_ref text DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.gi_create_proposal(p_title,p_details,p_priority,p_source_ref) $$;

CREATE FUNCTION public.gi_assign_task(p_id uuid,p_volunteer uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.gi_assign_task(p_id,p_volunteer) $$;

CREATE FUNCTION public.gi_task_action(p_id uuid,p_action text,p_note text DEFAULT NULL)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.gi_task_action(p_id,p_action,p_note) $$;

CREATE FUNCTION public.gi_log_minutes(p_id uuid,p_minutes integer,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.gi_log_minutes(p_id,p_minutes,p_note) $$;

CREATE FUNCTION public.gi_set_user_role(p_user uuid,p_role text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.gi_set_user_role(p_user,p_role) $$;

REVOKE ALL ON FUNCTION
 public.gi_create_proposal(text,text,text,text),
 public.gi_assign_task(uuid,uuid),
 public.gi_task_action(uuid,text,text),
 public.gi_log_minutes(uuid,integer,text),
 public.gi_set_user_role(uuid,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
 public.gi_create_proposal(text,text,text,text),
 public.gi_assign_task(uuid,uuid),
 public.gi_task_action(uuid,text,text),
 public.gi_log_minutes(uuid,integer,text),
 public.gi_set_user_role(uuid,text)
TO authenticated;
REVOKE ALL ON FUNCTION
 private.gi_create_proposal(text,text,text,text),
 private.gi_assign_task(uuid,uuid),
 private.gi_task_action(uuid,text,text),
 private.gi_log_minutes(uuid,integer,text),
 private.gi_set_user_role(uuid,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
 private.gi_create_proposal(text,text,text,text),
 private.gi_assign_task(uuid,uuid),
 private.gi_task_action(uuid,text,text),
 private.gi_log_minutes(uuid,integer,text),
 private.gi_set_user_role(uuid,text)
TO authenticated;

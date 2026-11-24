CREATE OR REPLACE FUNCTION public.gi_assign_proposed_task(p_id uuid, p_volunteer uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ''
AS $function$
BEGIN
  -- Both existing permission-checked RPCs execute in one transaction.
  -- The first locks the proposed row until the second completes.
  PERFORM public.gi_task_action(p_id,'publish',NULL);
  PERFORM public.gi_assign_task(p_id,p_volunteer);
END
$function$;
REVOKE ALL ON FUNCTION public.gi_assign_proposed_task(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gi_assign_proposed_task(uuid,uuid) TO authenticated;

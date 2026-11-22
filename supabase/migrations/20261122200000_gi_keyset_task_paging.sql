-- Keyset pagination for growing task pools. SECURITY INVOKER respects gi_tasks RLS.
CREATE OR REPLACE FUNCTION public.gi_list_tasks_page(
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 51,
  p_filter text DEFAULT 'all'
)
RETURNS SETOF public.gi_tasks
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT t.*
  FROM public.gi_tasks AS t
  WHERE (
    p_before_created_at IS NULL
    OR (p_before_id IS NOT NULL AND (t.created_at,t.id) < (p_before_created_at,p_before_id))
  )
  AND (
    p_filter='all'
    OR (p_filter='pool' AND t.status IN ('pool','proposed'))
    OR (p_filter='assigned' AND t.status IN ('assigned','accepted','in_progress','returned'))
    OR (p_filter='submitted' AND t.status='submitted')
    OR (p_filter='approved' AND t.status='approved')
  )
  ORDER BY t.created_at DESC,t.id DESC
  LIMIT least(greatest(coalesce(p_limit,51),1),100)
$$;
REVOKE ALL ON FUNCTION public.gi_list_tasks_page(timestamptz,uuid,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gi_list_tasks_page(timestamptz,uuid,integer,text) TO authenticated;

ALTER TABLE public.gi_incidents ADD COLUMN IF NOT EXISTS extra_points jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.gi_incidents ADD CONSTRAINT gi_incidents_extra_points_shape CHECK (jsonb_typeof(extra_points)='array' AND jsonb_array_length(extra_points)<=19);
CREATE OR REPLACE FUNCTION private.gi_incident_points_draft(p_id uuid,p_description text,p_category text,p_event_state text,p_lat numeric,p_lon numeric,p_observed timestamptz,p_extra_points jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE point jsonb; v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR coalesce(private.gi_role(),'pending') NOT IN ('candidate','volunteer','coordinator','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_extra_points IS NULL OR jsonb_typeof(p_extra_points)<>'array' THEN RAISE EXCEPTION 'Invalid points'; END IF;
 IF jsonb_array_length(p_extra_points)>19 OR (jsonb_array_length(p_extra_points)>0 AND (p_lat IS NULL OR p_lon IS NULL)) THEN RAISE EXCEPTION 'Invalid points count'; END IF;
 FOR point IN SELECT value FROM jsonb_array_elements(p_extra_points) LOOP
  IF jsonb_typeof(point)<>'array' THEN RAISE EXCEPTION 'Invalid point'; END IF;
  IF jsonb_array_length(point)<>2 OR jsonb_typeof(point->0)<>'number' OR jsonb_typeof(point->1)<>'number' THEN RAISE EXCEPTION 'Invalid point'; END IF;
  IF (point->>0)::numeric NOT BETWEEN -90 AND 90 OR (point->>1)::numeric NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid point range'; END IF;
 END LOOP;
 v_id:=private.gi_incident_draft(p_id,p_description,p_category,p_event_state,p_lat,p_lon,p_observed);
 UPDATE public.gi_incidents SET extra_points=p_extra_points WHERE id=v_id AND reporter_id=auth.uid() AND status='draft' AND is_demo;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
 RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.gi_incident_points_draft(p_id uuid,p_description text,p_category text,p_event_state text,p_lat numeric,p_lon numeric,p_observed timestamptz,p_extra_points jsonb)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path TO '' AS $$ SELECT private.gi_incident_points_draft(p_id,p_description,p_category,p_event_state,p_lat,p_lon,p_observed,p_extra_points) $$;
REVOKE ALL ON FUNCTION private.gi_incident_points_draft(uuid,text,text,text,numeric,numeric,timestamptz,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.gi_incident_points_draft(uuid,text,text,text,numeric,numeric,timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gi_incident_points_draft(uuid,text,text,text,numeric,numeric,timestamptz,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gi_incident_points_draft(uuid,text,text,text,numeric,numeric,timestamptz,jsonb) TO authenticated;

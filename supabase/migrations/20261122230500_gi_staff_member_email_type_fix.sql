-- Align auth.users.email varchar(255) to the public RPC's text return type.
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
    SELECT u.id,u.email::text,(u.email_confirmed_at IS NOT NULL)
    FROM auth.users u JOIN public.gi_profiles p ON p.id=u.id
    WHERE u.id=ANY(p_ids);
END
$$;
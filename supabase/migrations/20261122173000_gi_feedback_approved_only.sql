-- Only approved GI pilot members may post feedback; pending accounts remain read-only.
DROP POLICY IF EXISTS "gi_feedback_insert_own" ON public.gi_feedback;
CREATE POLICY "gi_feedback_insert_own" ON public.gi_feedback
FOR INSERT TO authenticated
WITH CHECK (
  reporter_id = (select auth.uid()) AND
  (select private.gi_role()) IN ('volunteer','coordinator','admin')
);

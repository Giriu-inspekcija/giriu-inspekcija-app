-- Indexes for paging through thousands of synthetic tasks and volunteer profiles.
-- No changes to current task/role permissions or GI production registers.
CREATE INDEX IF NOT EXISTS gi_tasks_created_id_idx
  ON public.gi_tasks (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS gi_tasks_status_created_id_idx
  ON public.gi_tasks (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS gi_tasks_assigned_created_id_idx
  ON public.gi_tasks (assigned_to, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS gi_profiles_role_name_idx
  ON public.gi_profiles (role, display_name, id);
CREATE INDEX IF NOT EXISTS gi_profiles_created_idx
  ON public.gi_profiles (created_at DESC, id);
CREATE INDEX IF NOT EXISTS gi_feedback_created_id_idx
  ON public.gi_feedback (created_at DESC, id DESC);

-- Cover foreign keys used for task cleanup, staff audit and data integrity at larger scale.
CREATE INDEX IF NOT EXISTS gi_tasks_creator_idx ON public.gi_tasks(created_by);
CREATE INDEX IF NOT EXISTS gi_task_events_actor_idx ON public.gi_task_events(actor_id);
CREATE INDEX IF NOT EXISTS gi_role_events_actor_idx ON public.gi_role_events(actor_id);
CREATE INDEX IF NOT EXISTS gi_role_events_target_idx ON public.gi_role_events(target_id);
CREATE INDEX IF NOT EXISTS gi_work_logs_task_idx ON public.gi_work_logs(task_id);

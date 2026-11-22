-- Cover newly added foreign keys before GI pilot expands.
CREATE INDEX IF NOT EXISTS gi_registration_events_actor_idx ON public.gi_registration_events(actor_id);
CREATE INDEX IF NOT EXISTS gi_work_logs_reviewer_idx ON public.gi_work_logs(reviewed_by);

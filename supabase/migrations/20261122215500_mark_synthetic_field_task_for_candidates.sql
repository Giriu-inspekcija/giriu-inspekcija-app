-- Mark only the pre-existing synthetic forest-trail test task candidate-safe.
UPDATE public.gi_tasks SET task_kind='field_visit',candidate_safe=true,updated_at=now()
WHERE source_ref='SYNTH-001' AND is_demo=true AND status='pool' AND assigned_to IS NULL;

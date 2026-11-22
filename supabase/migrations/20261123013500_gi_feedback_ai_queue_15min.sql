-- Cheap 15-minute GI feedback intake. No external API, AI, email or GitHub calls.
-- The existing gi_feedback -> gi_feedback_review trigger already groups duplicates.
-- This queue tracks individual submissions with exact-once intake; downstream AI
-- groups entries and acknowledges only those it actually reviewed.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS private.gi_ai_feedback_queue (
  feedback_id uuid PRIMARY KEY REFERENCES public.gi_feedback(id) ON DELETE CASCADE,
  detected_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_note text
);
ALTER TABLE private.gi_ai_feedback_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.gi_ai_feedback_queue FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS gi_ai_feedback_queue_pending_idx
 ON private.gi_ai_feedback_queue (detected_at, feedback_id) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS private.gi_ai_feedback_poll_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_checked_at timestamptz,
  last_new_count integer NOT NULL DEFAULT 0 CHECK (last_new_count >= 0),
  pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count >= 0)
);
ALTER TABLE private.gi_ai_feedback_poll_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.gi_ai_feedback_poll_state FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.gi_ai_feedback_poll()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE
  inserted_count integer;
  pending_total integer;
BEGIN
  -- Serialise manual runs with cron; unique feedback_id prevents duplicates.
  PERFORM pg_catalog.pg_advisory_xact_lock(724152309);
  INSERT INTO private.gi_ai_feedback_queue(feedback_id)
    SELECT f.id FROM public.gi_feedback AS f
    WHERE NOT EXISTS (
      SELECT 1 FROM private.gi_ai_feedback_queue AS q WHERE q.feedback_id = f.id
    )
    ON CONFLICT (feedback_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  SELECT count(*) INTO pending_total FROM private.gi_ai_feedback_queue WHERE processed_at IS NULL;
  INSERT INTO private.gi_ai_feedback_poll_state(singleton,last_checked_at,last_new_count,pending_count)
    VALUES (true,now(),inserted_count,pending_total)
  ON CONFLICT (singleton) DO UPDATE SET
    last_checked_at = EXCLUDED.last_checked_at,
    last_new_count = EXCLUDED.last_new_count,
    pending_count = EXCLUDED.pending_count;
  RETURN pg_catalog.jsonb_build_object(
    'new', inserted_count,
    'pending', pending_total,
    'checked_at', now()
  );
END
$body$;

CREATE OR REPLACE FUNCTION private.gi_ai_feedback_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $body$
  SELECT pg_catalog.jsonb_build_object(
    'pending', (SELECT count(*) FROM private.gi_ai_feedback_queue WHERE processed_at IS NULL),
    'last_checked_at', (SELECT last_checked_at FROM private.gi_ai_feedback_poll_state WHERE singleton = true),
    'new_on_last_check', (SELECT last_new_count FROM private.gi_ai_feedback_poll_state WHERE singleton = true),
    'oldest_pending_at', (SELECT min(detected_at) FROM private.gi_ai_feedback_queue WHERE processed_at IS NULL)
  )
$body$;

CREATE OR REPLACE FUNCTION private.gi_ai_feedback_ack(p_ids uuid[], p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE affected integer;
BEGIN
  IF p_ids IS NULL OR pg_catalog.cardinality(p_ids) = 0
     OR pg_catalog.cardinality(p_ids) > 50 THEN
    RAISE EXCEPTION 'Specify between 1 and 50 reviewed feedback IDs.';
  END IF;
  IF char_length(coalesce(p_note,'')) > 500 THEN
    RAISE EXCEPTION 'Review note is too long.';
  END IF;
  UPDATE private.gi_ai_feedback_queue
    SET processed_at = now(),
        processed_note = nullif(pg_catalog.btrim(p_note),'')
  WHERE feedback_id = ANY(p_ids) AND processed_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  UPDATE private.gi_ai_feedback_poll_state SET
    pending_count = (SELECT count(*) FROM private.gi_ai_feedback_queue WHERE processed_at IS NULL)
    WHERE singleton = true;
  RETURN affected;
END
$body$;

REVOKE ALL ON FUNCTION private.gi_ai_feedback_poll() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.gi_ai_feedback_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.gi_ai_feedback_ack(uuid[],text) FROM PUBLIC, anon, authenticated;

-- Cron runs an in-database function only. This does NOT call an AI model.
SELECT cron.schedule(
  'gi-feedback-filter-15min',
  '*/15 * * * *',
  'SELECT private.gi_ai_feedback_poll();'
);

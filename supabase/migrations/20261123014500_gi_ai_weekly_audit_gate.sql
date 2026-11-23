-- Weekly AI audit state piggybacks on existing hourly ChatGPT check.
-- No new model invocations, new database cron, secrets or Netlify deploys.
CREATE TABLE private.gi_ai_weekly_audit_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_claimed_week date,
  claimed_at timestamptz,
  completed_at timestamptz,
  result_note text
);
ALTER TABLE private.gi_ai_weekly_audit_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.gi_ai_weekly_audit_control FROM PUBLIC,anon,authenticated;
INSERT INTO private.gi_ai_weekly_audit_control(singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE FUNCTION private.gi_ai_weekly_audit_due()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $body$
SELECT
  extract(isodow FROM now() AT TIME ZONE 'Europe/Vilnius') = 5
  AND (now() AT TIME ZONE 'Europe/Vilnius')::time >= TIME '10:00'
  AND (
    SELECT coalesce(last_claimed_week, DATE '1900-01-01')
      < date_trunc('week',now() AT TIME ZONE 'Europe/Vilnius')::date
    FROM private.gi_ai_weekly_audit_control WHERE singleton=true
  )
$body$;

CREATE FUNCTION private.gi_ai_weekly_audit_claim()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE claimed integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(724152312);
  IF NOT private.gi_ai_weekly_audit_due() THEN RETURN false; END IF;
  UPDATE private.gi_ai_weekly_audit_control
    SET last_claimed_week=date_trunc('week',now() AT TIME ZONE 'Europe/Vilnius')::date,
        claimed_at=now(),completed_at=NULL,result_note=NULL
    WHERE singleton=true;
  GET DIAGNOSTICS claimed=ROW_COUNT;
  RETURN claimed=1;
END
$body$;

CREATE FUNCTION private.gi_ai_weekly_audit_complete(p_result text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE done integer;
BEGIN
  IF length(trim(coalesce(p_result,''))) NOT BETWEEN 5 AND 500
    THEN RAISE EXCEPTION 'Provide a concise audit outcome'; END IF;
  UPDATE private.gi_ai_weekly_audit_control
    SET completed_at=now(),result_note=trim(p_result)
    WHERE singleton=true
      AND last_claimed_week=date_trunc('week',now() AT TIME ZONE 'Europe/Vilnius')::date
      AND claimed_at IS NOT NULL AND completed_at IS NULL;
  GET DIAGNOSTICS done=ROW_COUNT;
  RETURN done=1;
END
$body$;

-- Keep the original summary fields so the hourly cheap gate is backward-compatible.
CREATE OR REPLACE FUNCTION private.gi_ai_feedback_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $body$
  SELECT pg_catalog.jsonb_build_object(
    'pending', (SELECT count(*) FROM private.gi_ai_feedback_queue WHERE processed_at IS NULL),
    'last_checked_at', (SELECT last_checked_at FROM private.gi_ai_feedback_poll_state WHERE singleton=true),
    'new_on_last_check', (SELECT last_new_count FROM private.gi_ai_feedback_poll_state WHERE singleton=true),
    'oldest_pending_at', (SELECT min(detected_at) FROM private.gi_ai_feedback_queue WHERE processed_at IS NULL),
    'weekly_audit_due', private.gi_ai_weekly_audit_due(),
    'last_weekly_claimed_at', (SELECT claimed_at FROM private.gi_ai_weekly_audit_control WHERE singleton=true),
    'last_weekly_completed_at', (SELECT completed_at FROM private.gi_ai_weekly_audit_control WHERE singleton=true)
  )
$body$;

REVOKE ALL ON FUNCTION private.gi_ai_weekly_audit_due() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.gi_ai_weekly_audit_claim() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.gi_ai_weekly_audit_complete(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.gi_ai_feedback_summary() FROM PUBLIC,anon,authenticated;

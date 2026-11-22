import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../supabase/migrations/20261123013500_gi_feedback_ai_queue_15min.sql',import.meta.url),'utf8');
test('GI feedback intake is scheduled every 15 minutes as SQL only',()=>{
  assert.match(migration,/CREATE EXTENSION IF NOT EXISTS pg_cron/i);
  assert.match(migration,/'gi-feedback-filter-15min'/);
  assert.match(migration,/'\*\/15 \* \* \* \*'/);
  assert.match(migration,/'SELECT private\.gi_ai_feedback_poll\(\);'/);
  assert.doesNotMatch(migration,/net\.http_|https:|openai|github\.com/i);
});
test('intake is idempotent and has no public or authenticated access',()=>{
  assert.match(migration,/feedback_id uuid PRIMARY KEY/);
  assert.match(migration,/ON CONFLICT \(feedback_id\) DO NOTHING/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/processed_at IS NULL/);
  assert.match(migration,/REVOKE ALL ON TABLE private\.gi_ai_feedback_queue FROM PUBLIC, anon, authenticated/);
  assert.match(migration,/REVOKE ALL ON FUNCTION private\.gi_ai_feedback_summary\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration,/REVOKE ALL ON FUNCTION private\.gi_ai_feedback_ack\(uuid\[\],text\) FROM PUBLIC, anon, authenticated/);
});
test('acknowledgement is distinct from actually resolving a user report',()=>{
  assert.match(migration,/processed_note text/);
  assert.match(migration,/processed_at = now\(\)/);
  assert.doesNotMatch(migration,/UPDATE public\.gi_feedback_review/);
  assert.doesNotMatch(migration,/resolved_at\s*=/);
  assert.match(migration,/cardinality\(p_ids\) > 50/);
});

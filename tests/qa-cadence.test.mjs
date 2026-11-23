import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const staticWorkflow = read('.github/workflows/ci.yml');
const acceptance = read('.github/workflows/pilot-acceptance.yml');
const weekly = read('supabase/migrations/20261123014500_gi_ai_weekly_audit_gate.sql');

test('cheap static CI executes twice daily without a deploy action',()=>{
  assert.match(staticWorkflow,/schedule:\s*\n\s*#[^\n]*\n\s*- cron: '37 4,16 \* \* \*'/);
  assert.match(staticWorkflow,/runs-on: ubuntu-latest/);
  assert.match(staticWorkflow,/node --check pilot\/app\.js/);
  assert.match(staticWorkflow,/npm test/);
  assert.doesNotMatch(staticWorkflow,/\brun:\s*netlify\b/);
});

test('isolated browser acceptance executes three times weekly without production secrets',()=>{
  assert.match(acceptance,/cron: "17 5 \* \* 1,3,5"/);
  assert.match(acceptance,/supabase start -x/);
  assert.match(acceptance,/QA_BROWSER=1/);
  assert.match(acceptance,/playwright/);
  assert.doesNotMatch(acceptance,/\bnetlify deploy\b/);
});

test('weekly audit is a private once-per-week gate and does not spawn new cron or model calls',()=>{
  assert.match(weekly,/private\.gi_ai_weekly_audit_control/);
  assert.match(weekly,/private\.gi_ai_weekly_audit_due\(\)/);
  assert.match(weekly,/private\.gi_ai_weekly_audit_claim\(\)/);
  assert.match(weekly,/private\.gi_ai_weekly_audit_complete\(p_result text\)/);
  assert.match(weekly,/pg_advisory_xact_lock/);
  assert.match(weekly,/weekly_audit_due/);
  assert.match(weekly,/FROM PUBLIC,anon,authenticated/);
  assert.doesNotMatch(weekly,/net\.http_post|cron\.schedule|openai\.com|api\.openai/);
});

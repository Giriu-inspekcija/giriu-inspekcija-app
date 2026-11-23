import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const real=readFileSync(new URL('../supabase/migrations/20261123023000_gi_real_case_private_pilot.sql',import.meta.url),'utf8');
const old=readFileSync(new URL('../supabase/migrations/20261122154000_gi_synthetic_pilot.sql',import.meta.url),'utf8');
const integration=readFileSync(new URL('./acceptance/real_cases.py',import.meta.url),'utf8');

test('real cases are separate from synthetic records and deny unauthenticated access',()=>{
  for(const entity of ['gi_real_cases','gi_real_case_access','gi_real_case_events']){
    assert.match(real,new RegExp('CREATE TABLE public\\.'+entity));
    assert.match(real,new RegExp('ALTER TABLE public\\.'+entity+' ENABLE ROW LEVEL SECURITY'));
    assert.match(real,new RegExp('REVOKE ALL ON TABLE public\\.'+entity+' FROM PUBLIC,anon,authenticated'));
  }
  assert.match(old,/is_demo/);
  assert.doesNotMatch(real,/ALTER TABLE public\.gi_tasks|ALTER TABLE public\.gi_incidents/);
  assert.doesNotMatch(real,/GRANT ALL|GRANT DELETE|GRANT TRUNCATE/);
});

test('volunteer sees only assigned internal cases while restricted stays staff-only',()=>{
  assert.match(real,/sensitivity='internal'/);
  assert.match(real,/gi_real_case_access/);
  assert.match(real,/a\.revoked_at IS NULL/);
  assert.match(real,/private\.gi_role\(\)\)='volunteer'/);
  assert.match(real,/restricted cases cannot be downgraded|Restricted cases cannot be downgraded/);
  assert.match(integration,/assert visible==\[\{'id':internal\}\]/);
  assert.match(integration,/restricted/);
  assert.match(integration,/revoked_at/);
});

test('private immutable evidence is tied to one real case and uploader',()=>{
  assert.match(real,/VALUES \('gi-real-evidence','gi-real-evidence',false/);
  assert.match(real,/CREATE POLICY gi_real_evidence_read/);
  assert.match(real,/CREATE POLICY gi_real_evidence_upload/);
  assert.match(real,/split_part\(name,'\/',2\)=\(SELECT auth.uid\(\)\)::text/);
  assert.match(real,/a\.can_upload/);
  assert.doesNotMatch(real,/CREATE POLICY gi_real_evidence_(?:delete|update)/i);
  assert.match(integration,/assert not http\.get\(vfile,headers=vheaders/);
});

test('audit events are append-only and contain no user-supplied case text',()=>{
  assert.match(real,/CREATE TABLE public\.gi_real_case_events/);
  assert.match(real,/CREATE TRIGGER gi_real_cases_audit/);
  assert.match(real,/CREATE TRIGGER gi_real_access_audit/);
  assert.doesNotMatch(real,/GRANT INSERT,UPDATE ON TABLE public\.gi_real_case_events/);
  assert.doesNotMatch(real,/INSERT INTO public\.gi_real_case_events\([^)]*(?:summary|title)/);
});

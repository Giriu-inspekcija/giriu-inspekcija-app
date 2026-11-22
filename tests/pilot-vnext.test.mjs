import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261122230000_gi_pilot_registration_tasks_time_incidents.sql',import.meta.url),'utf8');
const emailFix=readFileSync(new URL('../supabase/migrations/20261122230500_gi_staff_member_email_type_fix.sql',import.meta.url),'utf8');

test('new pilot view references exactly defined UI controls',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(new Set(ids).size,ids.length,'HTML element IDs must be unique');
  const references=[...app.matchAll(/\$\('([A-Za-z0-9]+)'\)/g)].map(x=>x[1]);
  for(const id of new Set(references))assert.ok(ids.includes(id),'Missing DOM ID: '+id);
});
test('volunteers can follow the entire synthetic task cycle, including time logging',()=>{
  for(const action of ['claim','decline','unassign','accept','start','submit','approve','return']){
    assert.match(migration,new RegExp("p_action='"+action+"'"),action);
  }
  assert.match(migration,/FOR UPDATE/);
  assert.match(migration,/gi_task_events/);
  assert.match(migration,/candidate_safe/);
  assert.match(html,/id="taskSummary"/);
  assert.match(app,/data-step="claim"/);
  assert.match(app,/data-step="decline"/);
  assert.match(app,/gi_set_task_due/);
  assert.match(app,/data-log-time/);
  assert.match(app,/name="hours"/);
  assert.match(app,/name="minutes"/);
  assert.match(app,/p_minutes:total/);
});
test('registration withdrawal and staff rejection do not delete auth identities or grant roles',()=>{
  assert.match(html,/id="withdrawRegistration"/);
  assert.match(app,/data-reject-registration/);
  assert.match(app,/data-restore-registration/);
  assert.match(app,/gi_review_registration/);
  assert.match(migration,/gi_guard_registration_approval/);
  assert.match(migration,/gi_registration_events/);
  assert.doesNotMatch(migration,/delete from auth\.users/i);
});
test('staff can distinguish verified member emails but volunteer cannot query list',()=>{
  assert.match(migration,/private\.gi_member_emails/);
  assert.match(migration,/Staff permission required/);
  assert.match(emailFix,/u\.email::text/);
  assert.match(app,/memberEmails=/);
  assert.match(app,/memberEmails\[p\.id\]/);
});
test('work logs support coordinator approval and no own-time approval',()=>{
  assert.match(migration,/review_status/);
  assert.match(migration,/Self approval forbidden/);
  assert.match(app,/gi_review_work_log/);
  assert.match(html,/id="myTimeSummary"/);
});
test('observation form is demo-only and supports drafts without public photo storage',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.gi_incidents/);
  assert.match(migration,/ALTER TABLE public\.gi_incidents ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/gi_save_incident/);
  assert.match(html,/id="incidentForm"/);
  assert.match(html,/id="incidentDescription"/);
  assert.match(html,/Tik demonstracija/);
  assert.doesNotMatch(app,/storage\.from\(/);
});
test('mobile navigation and professional Google button remain accessible',()=>{
  for(const section of ['tasksSection','timeSection','incidentsSection','teamSection','feedbackSection']){
    assert.match(html,new RegExp('id="'+section+'"'));
  }
  assert.match(html,/aria-label="Darbo vietos skiltys"/);
  assert.match(html,/aria-label="Google"/);
  assert.match(html,/#EA4335/);
  assert.doesNotMatch(html,/<span class="google-mark" aria-hidden="true">G<\/span>/);
  assert.match(html,/id="switchAccount"/);
  assert.match(app,/textContent=currentUser\?'Atsijungti':'Kita paskyra'/);
});

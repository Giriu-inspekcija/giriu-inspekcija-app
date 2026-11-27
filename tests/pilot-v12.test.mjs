import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const js=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261122234500_gi_signup_cleanup_time_joint_review.sql',import.meta.url),'utf8');
const sw=readFileSync(new URL('../pilot/sw.js',import.meta.url),'utf8');

test('mobile top is compact, account sign-out stays visible, and action toast is present',()=>{
  assert.match(html,/<header><div class="brand">/);
  assert.match(html,/<div id="accountSwitchBar"[\s\S]*?<button id="switchAccount"/);
  assert.doesNotMatch(html,/<\/div><p>Bandomoji savanorių darbo vieta<\/p>/);
  assert.match(html,/\.brand img\{width:36px;height:36px\}/);
  assert.match(html,/body\.signed-in \.pilot-info\{display:none\}/);
  assert.match(html,/id="actionToast"/);
  assert.match(js,/mutationInFlight=true/);
  assert.match(js,/toast\(msg\)/);
});
test('new members are never approved before email confirmation',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION private\.gi_guard_registration_approval/);
  assert.match(sql,/u\.email_confirmed_at IS NOT NULL/);
  assert.match(js,/El\. paštas nepatvirtintas – savanorio teisių suteikti negalima/);
  assert.match(js,/memberEmails\[p\.id\]\?\.verified===true/);
});
test('invalid signup purge is explicit, admin-only, and preserves genuine accounts',()=>{
  assert.match(sql,/private\.gi_purge_invalid_signup/);
  assert.match(sql,/\(SELECT private\.gi_role\(\)\) <> 'admin'/);
  assert.match(sql,/v_user\.email_confirmed_at IS NOT NULL/);
  assert.match(sql,/v_profile\.registration_state NOT IN \('rejected','withdrawn'\)/);
  assert.match(sql,/EXISTS\(SELECT 1 FROM public\.gi_tasks/);
  assert.match(sql,/EXISTS\(SELECT 1 FROM public\.gi_work_logs/);
  assert.match(sql,/EXISTS\(SELECT 1 FROM public\.gi_incidents/);
  assert.match(sql,/private\.gi_purged_signup_audit/);
  assert.match(js,/data-purge-invalid/);
  assert.match(js,/gi_purge_invalid_signup/);
  assert.match(js,/typed\.trim\(\)\.toLowerCase\(\)!==email\.toLowerCase\(\)/);
  assert.doesNotMatch(js,/delete from auth\.users/i);
});
test('manual time form works independently of tasks and limits selectable task list',()=>{
  for(const id of ['manualTimeForm','manualTimeTask','manualTimeActivity','manualTimeHours',
    'manualTimeMinutes','manualTimeNote','myTimeSummary','workLogsList','staffTimeLogs','staffTimePanel']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(js,/\.eq\('assigned_to',currentUser\.id\)/);
  assert.match(js,/\.order\('updated_at',\{ascending:false\}\)\.limit\(25\)/);
  assert.match(js,/gi_record_dated_time/);
  assert.match(sql,/ALTER TABLE public\.gi_work_logs ALTER COLUMN task_id DROP NOT NULL/);
  assert.match(sql,/activity_title/);
  assert.match(sql,/Only your own synthetic assigned task may receive time entries/);
  assert.match(js,/if\(!taskId&&\(title\.length<5/);
});
test('one-click result and time approval is server-side, auditable and not self-approved',()=>{
  assert.match(html,/Mano valandos/);
  assert.match(js,/data-joint-approve/);
  assert.match(js,/gi_approve_result_with_time/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION private\.gi_approve_result_with_time/);
  assert.match(sql,/v_task\.assigned_to=auth\.uid\(\)/);
  assert.match(sql,/review_status='approved'/);
  assert.match(sql,/review_status='submitted'/);
  assert.match(sql,/gi_task_events/);
});
test('task can be self-claimed without dropdown and delegated via explicit assignment',()=>{
  assert.match(js,/Prisiimti sau/);
  assert.match(js,/<summary aria-label="Priskirti savanoriui"><b>Priskirti<\/b><\/summary>/);
  assert.match(js,/data-assign/);
  assert.match(js,/>Priskirti<\/button>/);
  assert.doesNotMatch(js,/Perduoti kitam/);
  assert.match(js,/data-time-for-task/);
});
test('own time entries remain visible to admin separately from other volunteer approvals',()=>{
  assert.match(js,/\.eq\('volunteer_id',currentUser\.id\)/);
  assert.match(js,/client\.rpc\('gi_review_queue'\)/);
  assert.match(js,/\$\('staffTimeLogs'\)\.addEventListener\('click',handleTimeReviewClick\)/);
  assert.match(js,/\$\('workLogsList'\)\.innerHTML=mine\.length/);
  assert.match(sw,/gi-pilot-shell-\d+\.\d+\.\d+-source/);
});
test('all directly referenced input elements still exist',()=>{
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]));
  assert.equal(ids.size,[...html.matchAll(/\bid="([^"]+)"/g)].length);
  for(const m of js.matchAll(/\$\('([A-Za-z0-9]+)'\)/g))assert.ok(ids.has(m[1]),'Missing '+m[1]);
});

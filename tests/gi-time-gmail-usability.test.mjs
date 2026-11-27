import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const sw=readFileSync(new URL('../pilot/sw.js',import.meta.url),'utf8');

test('time view has a discoverable quick-add action and compact expandable history',()=>{
  assert.match(html,/id="addHoursQuick"/);
  assert.match(html,/id="timeEntryPanel"/);
  assert.match(html,/id="timeHistoryPanel"/);
  assert.match(html,/<details id="staffTimePanel"/);
  assert.match(html,/id="staffTimeLogs"/);
  assert.match(app,/\$\('addHoursQuick'\)\.addEventListener\('click'/);
  assert.match(app,/panel\.scrollIntoView\(\{block:'nearest',behavior:'smooth'\}\)/);
});
test('quick durations update BOTH input fields and allow manual override',()=>{
  for(const val of [15,30,60,90,120,180])assert.match(html,new RegExp('data-time-preset="'+val+'"'));
  assert.match(app,/Math\.floor\(value\/60\)/);
  assert.match(app,/String\(value%60\)/);
  assert.match(app,/function updateTimePresetButtons\(\)/);
  assert.match(app,/aria-pressed/);
  assert.match(app,/\$\('timeHistoryPanel'\)\.open=true/);
  assert.match(app,/gi_record_dated_time/);
  assert.match(app,/\[15,30,60,90,120,180\]/);
  assert.match(app,/p_request:timeRequest\.id|params\.p_request=timeRequest\.id/);
});
test('candidate-only privilege is tucked away and retains RLS checked RPC',()=>{
  assert.match(app,/class="candidate-options" data-ui-key="candidate-/);
  assert.match(app,/Kandidato prieiga/);
  assert.match(app,/data-candidate-task/);
  assert.match(app,/gi_set_candidate_task/);
});
test('Gmail proposals remain staff-only, reviewable, and link to authorized mailbox only',()=>{
  assert.match(html,/<details class="card" id="aiProposalPanel"/);
  assert.match(app,/if\(!staff\(\)\)return/);
  assert.match(app,/\^agent:gmail/);
  assert.match(app,/rel="noopener noreferrer"/);
  assert.match(app,/tik su GI Gmail prieiga/);
  assert.match(app,/Patvirtinti į fondą/);
  assert.match(app,/gi_task_action/);
  assert.doesNotMatch(html,/1a2089422577695f|1a208853eee2cb4b/);
});
test('parallel, bounded workspace refresh avoids long chains and focus-trigger duplication',()=>{
  assert.match(app,/const \[totals,ownLogs,pendingLogs,ownTaskResult,incidentResult,reviewer,docs,defaults\]=await Promise\.all/);
  assert.match(app,/const \[feedbackResult,queue,reminder\]=await Promise\.all/);
  assert.match(app,/admin\(\)\?client\.rpc\('gi_get_time_project_defaults'\):Promise\.resolve\(\{data:null\}\)/);
  assert.match(app,/lastAutoRefreshAt<60000/);
});
test('PWA cache changed without caching private API calls',()=>{
  assert.match(sw,/v32-location-details/);
  assert.match(sw,/NEVER cache Supabase requests/);
  assert.doesNotMatch(sw,/supabase\.co/);
  assert.doesNotThrow(()=>new Function(app));
});

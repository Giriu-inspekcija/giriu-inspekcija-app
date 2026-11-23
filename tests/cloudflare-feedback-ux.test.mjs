import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const sw=readFileSync(new URL('../pilot/sw.js',import.meta.url),'utf8');
const build=readFileSync(new URL('../scripts/build-pages.mjs',import.meta.url),'utf8');

test('Cloudflare public build is canonical and safely sends root to real pilot',()=>{
  assert.match(build,/writeFileSync\(join\(output,'index.html'\)/);
  assert.ok(build.includes("location.replace('/pilot/')"));
  assert.doesNotMatch(build,/copyFileSync\(join\(root,'supabase'/);
});

test('one form offers direct verified volunteer assignment, pool or a draft proposal',()=>{
  assert.match(html,/id="newTaskDestination"/);
  assert.match(html,/value="pool">Į bendrą užduočių fondą/);
  assert.match(html,/value="assigned">Iškart paskirti savanoriui/);
  assert.match(html,/value="proposed">Tik išsaugoti pasiūlymą/);
  assert.match(html,/id="newTaskAssigneeWrap" hidden/);
  assert.match(app,/memberEmails\[m\.id\]\?\.verified===true/);
  assert.match(app,/newTaskAssignee'\)\.required=assigned/);
  for(const rpc of ['gi_submit_task','gi_task_action','gi_assign_task'])
    assert.ok(app.includes("client.rpc('"+rpc+"'"),rpc+' RPC missing');
  assert.match(app,/if\(!proposalRef\)proposalRef=crypto\.randomUUID\(\)/);
  assert.match(app,/form\.reset\(\);proposalRef=null;updateNewTaskDestination\(\)/);
});

test('opening task history loads automatically, with cached results and inline error/retry',()=>{
  assert.match(app,/function loadTaskHistory\(id,box,button/);
  assert.match(app,/taskHistoryRequests\.has\(id\)/);
  assert.match(app,/taskList'\)\.addEventListener\('toggle'/);
  assert.match(app,/details\.task-actions-more/);
  assert.match(app,/\},true\);\s*\$\('taskList'\)\.addEventListener\('click'/);
  assert.match(app,/box\.textContent='Įkeliama veiksmų istorija/);
  assert.match(app,/box\.textContent='Istorijos nepavyko įkelti/);
  assert.match(app,/Bandyti dar kartą/);
});

test('iPhone feedback dialog remains in viewport without invoking keyboard immediately',()=>{
  assert.match(html,/#quickFeedbackDialog\{position:fixed;inset:50% auto auto 50%/);
  assert.match(app,/dialog\.scrollTop=0/);
  assert.match(app,/quickFeedbackClose'\)\.focus\(\{preventScroll:true\}\)/);
  assert.match(html,/id="quickFeedback" class="feedback-fast"/);
});

test('acknowledged writes never become a false failure due to subsequent UI refresh',()=>{
  assert.match(app,/if\(navigator\.onLine===false\)/);
  assert.match(app,/if\(result\?\.error\)throw result\.error/);
  assert.match(app,/if\(!refreshed\)\{/);
  assert.match(app,/Veiksmas išsaugotas serveryje, bet ekranas neatsinaujino/);
  assert.match(sw,/v22-mobile-time-fast-refresh/);
  assert.doesNotMatch(app,/service_role|sb_secret_/);
});

test('every referenced new control exists once in the HTML',()=>{
  for(const id of ['newTaskDestination','newTaskAssigneeWrap','newTaskAssignee','proposalSubmit']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  }
  assert.doesNotThrow(()=>new Function(app));
});

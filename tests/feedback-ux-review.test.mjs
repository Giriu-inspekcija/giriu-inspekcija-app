import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const thread=readFileSync(new URL('../pilot/team-thread.js',import.meta.url),'utf8');

test('contextual feedback opens a native-styled in-app sheet from any workspace and full case card',()=>{
  for(const id of ['quickFeedbackDialog','quickFeedbackForm','quickFeedbackContext','quickFeedbackSend','quickFeedbackClose','threadQuickFeedback','quickFeedback']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(app,/function openQuickFeedback\(\)/);
  assert.match(app,/if\(!dialog\.open\)dialog\.showModal\(\)/);
  assert.match(app,/threadQuickFeedback'\)\.addEventListener\('click',openQuickFeedback\)/);
  assert.match(app,/quickFeedbackForm'\)\.addEventListener\('submit'/);
  assert.match(app,/client\.from\('gi_feedback'\)\.insert/);
  assert.match(app,/if\(activePanel==='feedback'\)await refreshWorkspace\(\)/);
  assert.match(app,/if\(\$\('quickFeedbackDialog'\)\.open\)\$\('quickFeedbackDialog'\)\.close/);
});

test('mobile UI avoids native prompt/confirm/alert dialogs and provides tap feedback',()=>{
  assert.doesNotMatch(app,/(?:window\.)?(?:confirm|prompt|alert)\s*\(/);
  assert.doesNotMatch(thread,/(?:window\.)?(?:confirm|prompt|alert)\s*\(/);
  assert.match(html,/button:active:not\(:disabled\)/);
  assert.match(html,/#decision,#quickFeedbackDialog/);
  assert.match(html,/position:fixed;inset:auto 0 0/);
  assert.match(app,/button\.setAttribute\('aria-busy','true'\)/);
});

test('feedback queue and archive are compact by default with on-demand expansion',()=>{
  assert.match(html,/id="feedbackQueuePanel" hidden/);
  assert.match(html,/id="feedbackArchive"/);
  assert.match(html,/id="feedbackResolvedToggle"/);
  assert.match(html,/id="feedbackMore"/);
  assert.match(app,/feedbackVisibleCount=4/);
  assert.match(app,/feedback\.slice\(0,feedbackVisibleCount\)/);
  assert.match(app,/feedbackGroups\.filter\(g=>!g\.resolved_at\)/);
  assert.match(app,/class="feedback-item"/);
  assert.match(app,/escapeHTML\(item\.message\)|escapeHTML\(message\)/);
  assert.match(app,/feedbackVisibleCount\+=10/);
});

test('task history is collapsed and only latest five events render until expanded',()=>{
  assert.match(thread,/class="thread-events"/);
  assert.match(thread,/historyItems\(history\.slice\(0,5\)\)/);
  assert.match(thread,/data-expand-history="1"/);
  assert.match(thread,/historyItems\(active\.history\|\|\[\]\)/);
});

test('approving suggested tasks does not prompt twice and still calls authenticated RPC',()=>{
  const start=app.indexOf("$('aiProposalList').addEventListener");
  const end=app.indexOf('// ChatGPT-generated proposals',start);
  const handler=app.slice(start,end);
  assert.match(handler,/gi_task_action/);
  assert.match(handler,/p_action:'publish'/);
  assert.doesNotMatch(handler,/await ask\(/);
});

test('coordinator creates feedback-based tasks with one inline form, not sequential prompts',()=>{
  assert.match(app,/data-feedback-start/);
  assert.match(app,/data-feedback-create/);
  assert.match(app,/form\.hidden=!form\.hidden/);
  assert.match(app,/p_action:'task'/);
  assert.match(app,/gi_review_feedback_group/);
  assert.doesNotMatch(app,/Koks užduoties pavadinimas\?/);
});

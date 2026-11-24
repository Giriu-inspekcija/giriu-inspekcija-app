import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../pilot/sw.js',import.meta.url),'utf8');

test('ChatGPT inbox has distinct staff-only UI and explicit approval',()=>{
  for(const id of ['staffPanel','aiProposalPanel','aiProposalList','aiProposalCount','aiRefresh']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(app,/\$\('staffPanel'\)\.hidden = !staff\(\)/);
  assert.match(app,/\$\('aiProposalList'\)\.addEventListener\('click'/);
  assert.match(app,/data-ai-approve/);
  assert.match(app,/p_action:'publish'/);
  assert.match(app,/p_action:'publish'/);
  assert.match(app,/gi_task_action/);
});

test('inbox reads only unapproved agent proposals, with RLS and pagination',()=>{
  assert.match(app,/client\.from\('gi_tasks'\)/);
  assert.match(app,/\.eq\('status','proposed'\)\.like\('source_ref','agent:%'\)/);
  assert.match(app,/\.limit\(30\)/);
  assert.match(app,/if\(inbox\.error\|\|people\.error\)throw inbox\.error\|\|people\.error/);
  assert.match(app,/agentProposals=inbox\.data\|\|\[\]/);
  assert.match(app,/staff\(\)\?client\.from\('gi_tasks'\)/);
  assert.match(app,/escapeHTML\(t\.title\)/);
  assert.match(app,/taskDescription\(t,'ai-description-'\)/);
  assert.match(app,/escapeHTML\(full\)/);
});

test('manual JSON is optional fallback; proposals are never automatically assigned',()=>{
  assert.match(html,/Atsarginis rankinis užduočių importas/);
  assert.match(html,/be kopijavimo/);
  assert.match(app,/gi_agent_propose|ChatGPT-generated proposals/);
  const start=app.indexOf("function renderAiProposals()");
  const end=app.indexOf("function renderTasks()",start);
  const inboxUi=app.slice(start,end);
  assert.doesNotMatch(inboxUi,/client\.rpc/);
  assert.match(inboxUi,/assignmentActions/);
  assert.match(sw,/gi-pilot-shell-\d{8}-v\d+/);
});

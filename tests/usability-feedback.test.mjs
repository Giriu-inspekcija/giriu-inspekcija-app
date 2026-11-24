import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../pilot/sw.js',import.meta.url),'utf8');

test('mobile GI header stays compact with no conflicting late large-header override',()=>{
  assert.match(html,/header\{padding:9px 12px\}/);
  assert.match(html,/\.brand img\{width:36px;height:36px\}/);
  assert.doesNotMatch(html,/header\{padding:18px 15px\}/);
  assert.doesNotMatch(app,/profile\.display_name \? 'Labas, '/);
});

test('navigation is a grid with short labels, not an overflowing one-line toolbar',()=>{
  for(const name of ['Darbai','Valandos','Įvykiai','Dokumentai','Komanda','Pastabos'])
    assert.match(html,new RegExp('>'+name+'</button>'));
  assert.match(html,/\.workspace-nav\{display:grid/);
  assert.match(html,/@media\(max-width:720px\)\{\.workspace-nav\{grid-template-columns:repeat\(3/);
  assert.match(html,/id="workspaceNav"/);
});

test('feedback is available from every authenticated workspace section with source context',()=>{
  assert.match(html,/id="quickFeedback"/);
  assert.match(html,/id="feedbackContext"/);
  assert.match(html,/id="feedbackArchive"/);
  assert.match(app,/\$\('quickFeedback'\)\.addEventListener/);
  assert.match(app,/feedbackOrigin=activePanel/);
  assert.match(app,/const message=origin\?'\['\+origin\+'\] '\+raw:raw/);
  assert.match(app,/gi_feedback'\)\.insert\(/);
  assert.match(app,/Pastaba išsiųsta\./);
});

test('refresh preserves expanded task controls, unsaved drafts and scroll position',()=>{
  assert.match(app,/function captureWorkspaceUi\(\)/);
  assert.match(app,/function restoreWorkspaceUi\(state\)/);
  assert.match(app,/data-ui-key="due-/);
  assert.match(app,/data-ui-key="assign-/);
  assert.match(app,/data-task/);
  assert.match(app,/docBodies=new Map/);
  assert.match(app,/const uiState=captureWorkspaceUi\(\)/);
  assert.match(app,/restoreWorkspaceUi\(uiState\)/);
  assert.match(app,/window\.scrollBy\(0,delta\)/);
  assert.match(app,/state\.controls\.get\(key\)/);
});

test('task descriptions are expandable and histories fetched only when explicitly requested',()=>{
  assert.match(app,/function taskDescription\(task/);
  assert.match(app,/Rodyti visą aprašymą/);
  assert.match(app,/data-load-history/);
  assert.match(app,/client\.from\('gi_task_events'\)/);
  assert.match(app,/\.eq\('task_id',id\)/);
  assert.match(app,/taskHistoryCache/);
});

test('GI document editor links real Drive templates but never pretends automatic AI import',()=>{
  assert.match(html,/GI rašto šablonas „Drive“/);
  assert.match(html,/TAIS \/ ChatGPT užklausos šablonas/);
  assert.match(html,/DI jų automatiškai neskaito/);
  assert.match(html,/id="documentCase"/);
  assert.match(html,/id="documentAiPrompt"/);
  assert.match(app,/p_case:data\.get\('case'\)\|\|null/);
  assert.match(app,/navigator\.clipboard\.writeText\(prompt\)/);
  assert.match(app,/Tai tik juodraštis: nieko nepasirašyk ir nesiųsk/);
  assert.doesNotMatch(app,/service_role/);
});

test('new UI controls have matching DOM elements and IDs are unique',()=>{
  assert.doesNotThrow(()=>new Function(app));
  const found=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
  const ids=new Set(found);
  assert.equal(ids.size,found.length);
  const references=[...app.matchAll(/\$\('([A-Za-z0-9]+)'\)/g)].map(x=>x[1]);
  for(const ref of new Set(references))assert.ok(ids.has(ref),'Missing DOM ID '+ref);
  assert.match(sw,/v31-map-controls/);
});

test('task view shortcuts use the existing protected API filters',()=>{
  for(const view of ['mine','pool','all']) assert.match(html,new RegExp('data-task-view="'+view+'"'));
  assert.match(html,/class="task-quick-views"/);
  assert.match(app,/\$\('taskQuickViews'\)\.addEventListener\('click'/);
  assert.match(app,/taskFilter=view==='pool'\?'pool':'all'/);
  assert.match(app,/ownerFilter=view==='mine'\?'mine':''/);
  assert.match(app,/gi_search_tasks_page/);
});
test('coordinator sees a compact task preview with a direct self-claim and preserved task links',()=>{
  assert.match(app,/compactDescription=taskDescription\(t\)/);
  assert.match(app,/thread\.link\('task',t\.id,t\.title\)/);
  assert.match(app,/data-ui-key="manage-/);
  assert.match(app,/Prisiimti sau/);
  assert.match(app,/const controls=buttonsFor\(t,\{management:false\}\)\+timeEntry\(t\)/);
});
test('claim and accept offer a brief direct link to the newly assigned task',()=>{
  assert.match(app,/function showTaskToastLink\(id\)/);
  assert.match(app,/a\.dataset\.thread='task'/);
  assert.match(app,/showTaskToastLink\(id\)/);
  assert.match(app,/action==='claim'\|\|action==='accept'/);
});
test('incident editor keeps two clear actions and retains hidden new-draft utility',()=>{
  assert.match(html,/value="draft"[^>]*>Išsaugoti juodraštį/);
  assert.match(html,/value="submit"[^>]*>Pateikti pranešimą/);
  assert.match(html,/class="incident-advanced"/);
  assert.match(html,/id="incidentClear"/);
  assert.match(html,/Ribotas duomenų režimas/);
  assert.match(app,/\$\('incidentClear'\)\.addEventListener/);
});

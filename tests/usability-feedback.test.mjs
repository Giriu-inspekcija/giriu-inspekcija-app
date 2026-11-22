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
  assert.match(app,/Pastaba užregistruota/);
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
  assert.match(app,/t\.details\?\.length>260/);
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
  assert.match(sw,/v16-ai-proposals/);
});

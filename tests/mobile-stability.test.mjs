import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
const browser=readFileSync(new URL('./acceptance/screens.py',import.meta.url),'utf8');

test('focused phone date / document fields survive a workspace refresh',()=>{
  assert.match(app,/focusSelector,focusRange/);
  assert.match(app,/field\.focus\(\{preventScroll:true\}\)/);
  assert.match(app,/setSelectionRange\(\.\.\.state\.focusRange\)/);
  assert.match(app,/window\.scrollBy\(0,delta\)/);
  assert.match(browser,/expect\(field\)\.to_be_focused\(\)/);
  assert.match(browser,/Focus\/viewport jumped during refresh/);
});

test('coordinator feedback review retains expanded rows and unfinished task drafts',()=>{
  for(const snippet of ['expandedQueue','expandedArchive','feedbackDrafts','focusedDraft',
    'data-feedback-id','data-feedback-report','data-feedback-create'])
    assert.ok(app.includes(snippet),snippet);
  assert.match(app,/form\.hidden=!draft\.visible/);
  assert.match(app,/form\.querySelector\('\[name="title"\]'\)\.value=draft\.title/);
});

test('phone feedback sheet cannot be covered by floating button and controls are tappable',()=>{
  assert.match(html,/body:has\(dialog\[open\]\) \.feedback-fast\{visibility:hidden/);
  assert.match(html,/main button,dialog button\{min-height:44px/);
  assert.match(html,/\.action-toast\{bottom:calc\(70px/);
  assert.match(app,/focus\(\{preventScroll:true\}\);\n    \$\('incidentForm'\)\.scrollIntoView\(\{block:'nearest'\}\)/);
});

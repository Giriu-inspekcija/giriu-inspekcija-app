import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=read('pilot/app.js'), html=read('pilot/index.html'), map=read('pilot/incident-location.js');
test('initial login is hidden until session check; single in-flight initialization',()=>{
  assert.match(html,/<section id="authLoading"/);
  assert.match(html,/<section id="authView" hidden>/);
  assert.match(app,/if\(signInFlight\)return signInFlight/);
  assert.match(app,/await googleProviderReady/);
  assert.match(app,/if\(passwordRecovery\|\|currentUser\?\.id!==data\.user\.id\)return/);
});
test('map collapses in normal and fullscreen views; filter applies to point and polygons',()=>{
  assert.match(html,/id="mapSheetToggle"[^>]+aria-controls="mapControlsContent">/);
  assert.match(map,/setSheetCollapsed\(false\);el\('mapSheetToggle'\).hidden=false/);
  assert.match(map,/rows\.filter\(row=>permitMatches\(row,permitFilter\)\)/);
  assert.match(map,/permitMatches\(feature\.properties\|\|\{\},req\.permitFilter\)/);
  const a=map.indexOf('  const permitDay='), b=map.indexOf('  function permitFacts(',a);
  assert.ok(a>=0&&b>a);
  const matches=vm.runInNewContext(map.slice(a,b)+'\npermitMatches');
  const today='2026-11-27';
  const row={galioja_nuo:'2026-01-01',galioja_iki:'2026-11-27'};
  assert.equal(matches(row,'active',today),true);
  assert.equal(matches({...row,galioja_iki:'2026-11-26'},'expired',today),true);
  assert.equal(matches({...row,leid_busena:'Atšauktas'},'active',today),false);
  assert.equal(matches({...row,galioja_nuo:'2026-11-28'},'active',today),false);
  assert.equal(matches({},'active',today),false);
  assert.equal(matches({},'all',today),true);
});
test('compact incident details preserve existing actions and expansion',()=>{
  assert.match(app,/details class="card incident-compact"/);
  assert.match(app,/expanded\.has\(v\.id\)/);
  assert.match(app,/Atverti kortelę ir istoriją/);
});
test('feedback retry keeps id, verifies exact ownership and payload on duplicate',()=>{
  const a=app.indexOf('async function submitFeedback('),b=app.indexOf("$('feedbackForm').addEventListener",a);
  const fn=app.slice(a,b);
  assert.match(fn,/if\(!currentUser\|\|!approved\(\)\|\|feedbackSending\)return/);
  assert.match(fn,/feedbackRetry\?\.signature!==signature/);
  assert.match(fn,/insert\(\{id,reporter_id:owner,category,message\}\)/);
  assert.match(fn,/result\.error\.code!=='23505'/);
  assert.match(fn,/prior\.data\.category!==category\|\|prior\.data\.message!==message/);
  assert.match(fn,/feedbackRetry=null;\s*form\.reset\(\)/);
});

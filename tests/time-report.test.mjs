import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const app=readFileSync('pilot/app.js','utf8');
const html=readFileSync('pilot/index.html','utf8');
const start=app.indexOf('  function timeReportCsv(');
const end=app.indexOf('  function renderWorkLogs(){',start);
assert.ok(start>=0&&end>start);
const {csv,matches}=vm.runInNewContext(app.slice(start,end)+'; ({csv:timeReportCsv,matches:timeReportMatches})');
const row={id:'a',work_date:'2026-11-26',worker:{display_name:'Testas'},general_activity:false,project_label:'ALF 0025 / V2.1',activity_title:'Patikra',minutes:65,note:'=SUM(1;2)',review_status:'approved'};
test('approved project and general rows are distinct; returned and submitted excluded',()=>{
  assert.equal(matches(row,'project','alf 0025'),true);
  assert.equal(matches(row,'general',''),false);
  assert.equal(matches({...row,general_activity:true,project_label:null},'general',''),true);
  assert.equal(matches({...row,review_status:'returned'},'all',''),false);
  assert.equal(matches({...row,review_status:'submitted'},'project','ALF'),false);
});
test('CSV preserves exact minutes, quotes content and blocks formula injection',()=>{
  const output=csv([row,{...row,note:'a;"b"\ntext'}]);
  assert.ok(output.startsWith('\uFEFF'));
  assert.ok(output.includes('"65";"1,0833"'));
  assert.ok(output.includes("\"'=SUM(1;2)\""));
  assert.ok(output.includes('"a;""b""\ntext"'));
});
test('reports are staff gated and read fresh approved rows, not a truncated workspace cache',()=>{
  assert.match(app,/timeReportForm'\)\.addEventListener\('submit'/);
  assert.match(app,/if\(!staff\(\)\|\|!currentUser\)return;/);
  assert.match(app,/\.eq\('review_status','approved'\)\.gte\('work_date',from\)\.lte\('work_date',to\)/);
  assert.match(app,/query\.gt\('id',after\)/);
  assert.match(app,/rows\.length>10000\)throw Error/);
  assert.match(html,/id="staffTimePanel"[\s\S]*id="timeReportForm"/);
});

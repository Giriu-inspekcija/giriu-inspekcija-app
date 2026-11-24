import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
const thread=readFileSync(new URL('../pilot/team-thread.js',import.meta.url),'utf8');
test('task creation date is visible in list and detail',()=>{
  assert.ok(app.includes("window.giDeadlines.display(t.created_at)"));
  assert.ok(app.includes("+'</h3>'+created+compactDescription+due"));
  assert.ok(thread.includes("html(when(row.created_at))"));
});
test('primary actions remain visible; staff secondary actions are separate and self-unassign not duplicated',()=>{
  assert.ok(app.includes("buttonsFor(t,{management:false})+timeEntry(t)"));
  assert.ok(app.includes("staff()?buttonsFor(t,{personal:false})"));
  assert.ok(app.includes("task.status==='assigned'&&task.assigned_to!==currentUser?.id"));
  assert.ok(app.includes("task-primary-actions"));
  assert.ok(app.includes('data-step="decline"'));
});
test('search filters only own time-task options and preserves selected task',()=>{
  assert.ok(html.includes('id="manualTimeTaskSearch"'));
  assert.ok(app.includes("matching=timeOwnTasks.filter"));
  assert.ok(app.includes("||t.id===old"));
  assert.ok(app.includes("if(matching.some(t=>t.id===old))select.value=old"));
  assert.ok(app.includes("manualTimeTaskSearch').addEventListener('input',renderManualTimeTaskOptions)"));
  assert.ok(app.includes("manualTimeTaskSearch').value='';renderManualTimeTaskOptions()"));
});

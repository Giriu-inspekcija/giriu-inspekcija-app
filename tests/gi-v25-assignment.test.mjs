import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=read('pilot/app.js'),html=read('pilot/index.html'),sw=read('pilot/sw.js');
const sql=read('supabase/migrations/20261124105037_gi_atomic_proposed_task_assignment.sql');
test('visible version follows service-worker cache version',()=>{
 const version=sw.match(/gi-pilot-shell-(\d+\.\d+\.\d+)-source/)?.[1];
 assert.ok(version);
 assert.ok(html.includes('id="appVersion" title="Programėlės versija">v'+version+'</span>'));
});
test('direct assignment on task face and inbox shares explicit staff handler',()=>{
 assert.ok(app.includes("!assigned?assignmentActions(t)"));
 assert.ok(app.includes("assignmentActions({...t,status:'proposed'},{inbox:true})"));
 assert.ok(app.includes('data-assign-self'));
 assert.ok(app.includes("button.closest('article')?.querySelector('[data-person]')"));
 assert.ok(app.includes("task.status==='proposed'?'gi_assign_proposed_task':'gi_assign_task'"));
 assert.ok(app.includes('memberEmails[choice]?.verified===true'));
 assert.ok(app.includes('Boolean(currentUser.email_confirmed_at)'));
});
test('proposed assignment uses one invoker transaction and existing permissions',()=>{
 assert.match(sql,/SECURITY INVOKER/);
 assert.match(sql,/PERFORM public\.gi_task_action\(p_id,'publish',NULL\);\s*PERFORM public\.gi_assign_task\(p_id,p_volunteer\);/);
 assert.match(sql,/FROM PUBLIC, anon/);
 assert.doesNotMatch(sql,/SECURITY DEFINER|UPDATE public\.gi_tasks/);
});

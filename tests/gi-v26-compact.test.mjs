import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=read('pilot/app.js'),html=read('pilot/index.html'),thread=read('pilot/team-thread.js');
test('compact cards show primary controls and group other operations',()=>{
 assert.ok(app.includes('task-toolbar'));
 assert.ok(app.includes('secondaryAssignment+management'));
 assert.ok(app.includes("assigned?assignmentActions(t,{secondary:true})"));
 assert.ok(app.includes('aria-label="Kiti veiksmai ir istorija"'));
 assert.ok(html.includes('.task-toolbar .task-primary-actions .actions{display:contents}'));
});
test('description toggles both ways and full content is escaped',()=>{
 assert.ok(app.includes('escapeHTML(full.slice(0,105))'));
 assert.ok(app.includes('escapeHTML(full)'));
 assert.ok(html.includes('.task-description-toggle[open] .description-preview{display:none}'));
 assert.ok(html.includes('.task-description-toggle[open] .description-full{display:inline}'));
});
test('refresh icon is accessible and detail secondary controls are grouped',()=>{
 assert.ok(html.includes('id="refresh" class="outline" aria-label="Atnaujinti"'));
 assert.ok(thread.includes('class="thread-secondary"'));
 assert.ok(app.includes('details.task-actions-more[data-ui-key^="history-"]'));
});

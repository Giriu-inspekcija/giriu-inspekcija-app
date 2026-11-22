// Static migration checks only. These DO NOT replace Supabase integration/RLS tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations/20261122154000_gi_synthetic_pilot.sql', import.meta.url), 'utf8');

test('every GI table has row-level security enabled', () => {
  for (const name of ['gi_profiles','gi_tasks','gi_task_events','gi_work_logs','gi_role_events']) {
    assert.match(sql, new RegExp('alter table public\\.' + name + ' enable row level security;', 'i'));
  }
});
test('new registrations start with pending role, not volunteer/admin', () => {
  assert.match(sql, /default 'pending'/);
  assert.match(sql, /values \(new\.id,[\s\S]*?'pending'\)/);
});
test('role approval requires existing administrator', () => {
  assert.match(sql, /function public\.gi_set_user_role/);
  assert.match(sql, /coalesce\(\(select private\.gi_role\(\)\), 'pending'\) <> 'admin'/);
  assert.match(sql, /insert into public\.gi_role_events/);
});
test('no public client writes directly to tables', () => {
  assert.match(sql, /revoke all on public\.gi_profiles,[\s\S]*?from public, anon, authenticated/);
  assert.match(sql, /grant select on public\.gi_profiles,[\s\S]*?to authenticated/);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete|all) on public\.gi_tasks to authenticated/i);
});
test('task assignments check approved volunteer status', () => {
  assert.match(sql, /v_role not in \('volunteer','coordinator','admin'\)/);
  assert.match(sql, /assigned_to=p_volunteer/);
});
test('task mutations create audit events', () => {
  assert.match(sql, /insert into public\.gi_task_events\(task_id,actor_id,action,note\)/);
  assert.match(sql, /Invalid GI role or task transition/);
});
test('GI tasks must be synthetic and imports deduplicate by external ID', () => {
  assert.match(sql, /is_demo boolean not null default true check \(is_demo = true\)/);
  assert.match(sql, /source_ref text unique/);
  assert.match(sql, /on conflict \(source_ref\) do nothing/);
});
test('SECURITY DEFINER functions pin search_path', () => {
  for (const match of sql.matchAll(/security definer/g)) {
    const after = sql.slice(match.index,match.index+100);
    assert.match(after, /set search_path = ''/);
  }
});

test('missing roles fail closed for all privileged actions', () => {
  assert.match(sql, /coalesce\(\(select private\.gi_role\(\)\), 'pending'\) not in \('coordinator','admin'\)/);
  assert.match(sql, /coalesce\(\(select private\.gi_role\(\)\), 'pending'\) not in \('volunteer','coordinator','admin'\)/);
});
test('each SECURITY DEFINER function uses valid dollar quoting', () => {
  const count = [...sql.matchAll(/security definer set search_path = ''/g)].length;
  assert.equal(count, 7);
  assert.equal([...sql.matchAll(/as \$\$/g)].length, 7);
  assert.doesNotMatch(sql, /as \$\n/);
});

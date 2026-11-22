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
  assert.match(sql, /coalesce\(v_role, 'pending'\) not in \('volunteer','coordinator','admin'\)/);
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

test('feedback collection is protected and synthetic-only', () => {
  const feedback = readFileSync(new URL('../supabase/migrations/20261122162000_gi_synthetic_feedback.sql', import.meta.url),'utf8');
  assert.match(feedback, /alter table public\.gi_feedback enable row level security;/);
  assert.match(feedback, /reporter_id = \(select auth\.uid\(\)\)/);
  assert.match(feedback, /is_demo = true/);
  assert.doesNotMatch(feedback, /grant (?:update|delete|all) on public\.gi_feedback to authenticated/i);
});

test('privileged GI RPCs are private, public wrappers use SECURITY INVOKER', () => {
  const hardening = readFileSync(new URL('../supabase/migrations/20261122170000_gi_rpc_private_hardening.sql', import.meta.url), 'utf8');
  for (const name of ['gi_create_proposal','gi_assign_task','gi_task_action','gi_log_minutes','gi_set_user_role']) {
    assert.match(hardening, new RegExp('ALTER FUNCTION public\\.' + name + '\\('));
    assert.match(hardening, new RegExp('CREATE FUNCTION public\\.' + name + '\\('));
  }
  assert.equal([...hardening.matchAll(/SECURITY INVOKER/g)].length, 6);
  assert.match(hardening, /REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC, anon;/);
  assert.match(hardening, /GRANT EXECUTE ON FUNCTION[\s\S]*?TO authenticated;/);
});
test('feedback creation is only available to approved pilot members', () => {
  const approval = readFileSync(new URL('../supabase/migrations/20261122173000_gi_feedback_approved_only.sql', import.meta.url), 'utf8');
  assert.match(approval, /FOR INSERT TO authenticated/);
  assert.match(approval, /IN \('volunteer','coordinator','admin'\)/);
  assert.match(approval, /reporter_id = \(select auth\.uid\(\)\)/);
});

test('email-first onboarding is verified before password setup', () => {
  const html = readFileSync(new URL('../pilot/index.html', import.meta.url),'utf8');
  const js = readFileSync(new URL('../pilot/app.js', import.meta.url),'utf8');
  const sql = readFileSync(new URL('../supabase/migrations/20261122175000_gi_email_onboarding_bootstrap.sql', import.meta.url),'utf8');
  assert.match(html,/id="passwordSetupForm"/);
  assert.match(html,/id="activateMaster"/);
  assert.match(js,/auth\.signInWithOtp/);
  assert.match(js,/auth\.updateUser\(\{password:p\}\)/);
  assert.match(js,/client\.rpc\('gi_password_needed'\)/);
  assert.match(js,/client\.rpc\('gi_claim_first_admin'\)/);
  assert.match(js,/client\.rpc\('gi_is_bootstrap_candidate'\)/);
  assert.doesNotMatch(js,/zelaurynas@gmail\.com/i);
  assert.doesNotMatch(sql,/zelaurynas@gmail\.com/i);
});

test('scalable task paging uses RLS-safe cursor, not 150-row hard caps', () => {
  const app = readFileSync(new URL('../pilot/app.js', import.meta.url),'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/20261122200000_gi_keyset_task_paging.sql',import.meta.url),'utf8');
  assert.match(migration,/SECURITY INVOKER/i);
  assert.match(migration,/RETURNS SETOF public\.gi_tasks/i);
  assert.match(migration,/\(t\.created_at,t\.id\) < \(p_before_created_at,p_before_id\)/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.gi_list_tasks_page/);
  assert.match(app,/client\.rpc\('gi_list_tasks_page'/);
  assert.match(app,/const TASK_PAGE_SIZE = 50/);
  assert.match(app,/refreshWorkspace\(\{appendTasks:true\}\)/);
  assert.doesNotMatch(app,/\.limit\(150\)|\.limit\(200\)|\btaskPage\b/);
});
test('both coordinator and admin can assign tasks but volunteers cannot',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261122154000_gi_synthetic_pilot.sql',import.meta.url),'utf8');
  assert.match(sql,/function public\.gi_assign_task/);
  assert.match(sql,/coalesce\(\(select private\.gi_role\(\)\), 'pending'\) not in \('coordinator','admin'\)/);
});

test('new candidate is self-declared only, staff grants verified roles', () => {
  const sql=readFileSync(new URL('../supabase/migrations/20261122213000_candidate_roles_rank_and_document_permission.sql',import.meta.url),'utf8');
  const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
  assert.match(html,/value="new_candidate"/);
  assert.match(html,/value="existing_volunteer"/);
  assert.match(app,/membership_intent:membershipIntent/);
  assert.match(sql,/new\.raw_user_meta_data->>'membership_intent'/);
  assert.match(sql,/values?\(/i);
  assert.match(sql,/'pending'/);
  assert.match(sql,/candidate_safe/);
  assert.match(sql,/NOT v_task\.candidate_safe/);
  assert.match(sql,/gi_approve_candidate/);
  assert.match(sql,/gi_promote_candidate/);
  assert.match(sql,/gi_can_prepare_documents/);
  assert.match(sql,/GI staff permission required/);
  assert.doesNotMatch(app,/sb_secret_|service_role/);
});
test('ranks are distinct from document permissions', () => {
  const sql=readFileSync(new URL('../supabase/migrations/20261122213000_candidate_roles_rank_and_document_permission.sql',import.meta.url),'utf8');
  assert.match(sql,/volunteer_rank/);
  assert.match(sql,/can_prepare_documents/);
  assert.match(sql,/p\.role='volunteer' AND p\.can_prepare_documents/);
  assert.match(sql,/private\.gi_set_document_permission/);
  assert.match(sql,/GI admin approval required/);
  assert.match(sql,/public\.gi_member_events/);
  assert.doesNotMatch(sql,/GRANT (?:UPDATE|INSERT) ON public\.gi_profiles TO authenticated/i);
});

test('signup email button enforces 2-minute cooldown across reloads', () => {
  const js=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');
  assert.match(html,/id="signupSendStatus"/);
  assert.match(html,/aria-live="polite"/);
  assert.match(js,/const OTP_COOLDOWN_MS = 120000/);
  assert.match(js,/window\.localStorage\.setItem\(OTP_COOLDOWN_KEY/);
  assert.match(js,/window\.localStorage\.getItem\(OTP_COOLDOWN_KEY/);
  assert.match(js,/otpRequestInFlight\|\|otpRemainingSeconds\(\)>0/);
  assert.match(js,/reservedUntil=setOtpCooldown\(\)/);
  assert.match(js,/window\.addEventListener\('storage'/);
  assert.match(js,/clearOtpCooldownIfOwned\(reservedUntil\)/);
});

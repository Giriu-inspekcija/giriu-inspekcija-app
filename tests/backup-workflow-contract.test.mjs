import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/gi-encrypted-backup.yml',import.meta.url),'utf8');
const script=readFileSync(new URL('../scripts/gi_backup.sh',import.meta.url),'utf8');
const restore=readFileSync(new URL('../scripts/gi_restore.sh',import.meta.url),'utf8');
const client=readFileSync(new URL('../scripts/gi_backup_storage.py',import.meta.url),'utf8');

test('scheduled backup never publishes SQL or touches Netlify',()=>{
  assert.match(workflow,/cron: '23 2 \* \* \*'/);
  assert.doesNotMatch(workflow,/pull_request:/);
  assert.doesNotMatch(workflow,/(?:netlify\/|npx\s+netlify|netlify\s+deploy)/gi);
  assert.match(workflow,/GI_BACKUP_DB_URL: \$\{\{ secrets\.GI_BACKUP_DB_URL \}\}/);
  assert.match(workflow,/GI_BACKUP_AGE_RECIPIENT: \$\{\{ vars\.GI_BACKUP_AGE_RECIPIENT \}\}/);
  assert.match(workflow,/actions\/upload-artifact@v4/);
  assert.match(workflow,/gi-encrypted\/\*\.age/);
  assert.doesNotMatch(workflow,/path: .*\.sql/);
  assert.match(workflow,/retention-days: 30/);
  assert.doesNotMatch(workflow,/AGE-SECRET-KEY-/);
});

test('database and object bytes are exported and encrypted before offsite upload',()=>{
  assert.match(script,/supabase db dump.*--role-only/);
  assert.match(script,/supabase db dump.*schema\.sql/);
  assert.match(script,/supabase db dump.*--data-only/);
  assert.match(script,/--schema supabase_migrations/);
  assert.match(script,/gi_backup_storage\.py backup/);
  assert.match(script,/sha256sum roles\.sql/);
  assert.match(script,/age -r "\$GI_BACKUP_AGE_RECIPIENT" -r "\$test_recipient"/);
  assert.match(script,/cmp -s "\$tmp\/snapshot\.tar\.gz" "\$tmp\/roundtrip\.tar\.gz"/);
  assert.match(client,/Storage API/);
  assert.match(client,/h\.update\(block\)/);
  assert.match(client,/object_count/);
  assert.match(client,/public_at_snapshot/);
});

test('restores require separate project and human approval',()=>{
  assert.match(restore,/GI_RESTORE_CONFIRM/);
  assert.match(restore,/RESTORE_TO_ISOLATED_GI_TEST/);
  assert.match(restore,/mkhxokzuietqgjdpkcqq/);
  assert.match(restore,/sha256sum --quiet --check/);
  assert.match(restore,/gi_backup_storage\.py" restore/);
  assert.match(restore,/GI_RESTORE_TO_ISOLATED_TARGET=YES/);
});

test('Drive mirror uses restricted short-lived credentials and must verify the encrypted copy',()=>{
  assert.match(workflow,/id-token: write/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/google-github-actions\/auth@[a-f0-9]{40}/);
  assert.match(workflow,/token_format: access_token/);
  assert.match(workflow,/create_credentials_file: false/);
  assert.doesNotMatch(workflow,/GI_BACKUP_RCLONE_CONFIG_B64/);
  assert.ok(workflow.indexOf('actions/upload-artifact@v4')<workflow.indexOf('id: drive_auth'));
  assert.match(workflow,/run: python3 scripts\/gi_backup_drive\.py/);
  const mirror=readFileSync(new URL('../scripts/gi_backup_drive.py',import.meta.url),'utf8');
  assert.match(mirror,/sha256Checksum/);
  assert.match(mirror,/Duplicate archive name/);
  assert.doesNotMatch(mirror,/request\(session, "(?:DELETE|PATCH)"/);
  assert.match(script,/b >= 100_000_000/);
  assert.match(script,/31\*b/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../pilot/real-cases.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../pilot/real-cases.js',import.meta.url),'utf8');
const main=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const pilot=readFileSync(new URL('../pilot/index.html',import.meta.url),'utf8');

test('the sensitive cases UI is always fail-closed until operational approval',()=>{
  assert.match(js,/const WRITE_ENABLED = false;/);
  assert.match(js,/if\(warn\(\)\|\|busy\|\|navigator\.onLine===false\)/);
  assert.match(js,/if\(warn\(\)\|\|busy\)return;/);
  assert.match(html,/Tik išgalvotus|išgalvotus duomenis/);
  assert.doesNotMatch(js,/service_role|sb_secret_|PUBLIC_KEY\s*=\s*['"]eyJ/);
});

test('client verifies a server-issued user and role before displaying cases',()=>{
  assert.match(js,/db\.auth\.getUser\(\)/);
  assert.match(js,/\.from\('gi_profiles'\)\.select\('id,role'\)\.eq\('id',user\.id\)/);
  assert.match(js,/\['admin','coordinator','volunteer'\]/);
  assert.match(js,/\.from\('gi_real_cases'\)/);
  assert.match(main,/realCasesNav'\)\.hidden/);
  assert.match(pilot,/href="\.\/real-cases\.html"/);
});

test('evidence uses only authenticated private Storage endpoints, not public URLs',()=>{
  assert.match(js,/const BUCKET = 'gi-real-evidence'/);
  assert.match(js,/const store=db\.storage\.from\(BUCKET\)/);
  assert.match(js,/await store\.download\(path\)/);
  assert.match(js,/upsert:false/);
  assert.match(js,/const MAX_FILE_BYTES = 10 \* 1024 \* 1024/);
  assert.doesNotMatch(js,/createSignedUrl|getPublicUrl|\.innerHTML\s*=/);
});

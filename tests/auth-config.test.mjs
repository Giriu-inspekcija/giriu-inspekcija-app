import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_REF, PREVIEW_URL, LIVE_URL, CLOUDFLARE_URL, CLOUDFLARE_PAGES_URL, loadTemplates, makePatch,
  diffKeys, verifyConfig
} from '../scripts/sync-supabase-auth.mjs';

test('project is locked to the existing GI pilot', () => {
  assert.equal(PROJECT_REF,'mkhxokzuietqgjdpkcqq');
  assert.ok(PREVIEW_URL.startsWith('https://deploy-preview-5--starlit-shortbread-a38110.netlify.app/'));
  assert.equal(LIVE_URL,'https://starlit-shortbread-a38110.netlify.app/pilot/');
  assert.equal(CLOUDFLARE_URL,'https://komanda.giriuinspekcija.lt/pilot/');
  assert.equal(CLOUDFLARE_PAGES_URL,'https://giriu-inspekcija-app.pages.dev/pilot/');
});

test('3 Lithuanian emails have correct confirmation tokens, no active html', () => {
  const templates = loadTemplates();
  assert.equal(Object.keys(templates).length,6);
  for(const key of ['confirmation','magic_link','recovery']){
    assert.ok(templates['mailer_subjects_'+key].includes('Girių inspekcija'));
    const html=templates['mailer_templates_'+key+'_content'];
    assert.ok(html.includes('{{ .ConfirmationURL }}'));
    assert.equal((html.match(/\{\{\s*\.ConfirmationURL\s*\}\}/g)||[]).length,1);
  }
});

test('old localhost default changes to live pilot and keeps preview and existing redirects', () => {
  const current={site_url:'http://localhost:3000',uri_allow_list:'https://example.org/auth,https://app.giriuinspekcija.lt/'};
  const p=makePatch(current);
  assert.equal(p.site_url,LIVE_URL);
  assert.ok(p.uri_allow_list.includes('https://example.org/auth'));
  assert.ok(p.uri_allow_list.includes('https://app.giriuinspekcija.lt/'));
  assert.ok(p.uri_allow_list.includes(PREVIEW_URL));
  assert.ok(p.uri_allow_list.includes(LIVE_URL));
  assert.ok(p.uri_allow_list.includes(CLOUDFLARE_URL));
  assert.ok(p.uri_allow_list.includes(CLOUDFLARE_PAGES_URL));
  assert.ok(!Object.keys(p).some(k=>k.includes('smtp')));
});

test('configured production site URL is preserved', () => {
  const p=makePatch({site_url:'https://app.giriuinspekcija.lt/',uri_allow_list:''});
  assert.equal(p.site_url,undefined);
  assert.deepEqual(p.uri_allow_list,[PREVIEW_URL,LIVE_URL,CLOUDFLARE_URL,CLOUDFLARE_PAGES_URL].join(','));
});

test('second run is idempotent', () => {
  const current={site_url:LIVE_URL,uri_allow_list:[PREVIEW_URL,LIVE_URL,CLOUDFLARE_URL,CLOUDFLARE_PAGES_URL].join(',')};
  const patch=makePatch(current);
  assert.deepEqual(diffKeys({...current,...patch},patch),[]);
  assert.deepEqual(verifyConfig({...current,...patch},patch),[]);
});

test('readonly verify handles same redirect urls in different order',()=>{
  const p=makePatch({site_url:LIVE_URL,uri_allow_list:'https://gi.example/'});
  const actual={...p,uri_allow_list:[LIVE_URL,PREVIEW_URL,'https://gi.example/',CLOUDFLARE_URL,CLOUDFLARE_PAGES_URL].join(',')};
  assert.deepEqual(verifyConfig(actual,p),[]);
});

test('rejects bad configuration and insecure redirect base',()=>{
  assert.throws(()=>makePatch({}),/site_url/);
  assert.throws(()=>makePatch({site_url:'ftp://attacker.example',uri_allow_list:''}),/insecure site_url/);
  assert.throws(()=>makePatch({site_url:PREVIEW_URL,uri_allow_list:{any:'object'}}),/uri_allow_list/);
});

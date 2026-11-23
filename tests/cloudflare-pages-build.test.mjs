import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const out=join(root,'dist');
test('Cloudflare Pages bundle contains only public PWA assets',()=>{
  execFileSync(process.execPath,['scripts/build-pages.mjs'],{cwd:root});
  const required=[
    'index.html','sw.js','manifest.webmanifest','logo.png',
    'pilot/index.html','pilot/app.js','pilot/privatumas.html',
    'pilot/sw.js','pilot/manifest.webmanifest','pilot/vendor/fflate-0.8.2.js','_headers'
  ];
  for(const file of required)assert.ok(existsSync(join(out,file)),file+' missing');
  const privatePaths=['docs','tests','supabase','scripts','.github','package.json','README.txt'];
  for(const path of privatePaths)assert.equal(existsSync(join(out,path)),false,path+' leaked into public bundle');
  for(const path of readdirSync(out)) assert.ok(!path.startsWith('.'),'hidden file deployed: '+path);
  // The Cloudflare root must never expose the obsolete local-only DEMO app.
  const landing=readFileSync(join(out,'index.html'),'utf8');
  assert.ok(landing.includes('content="0; url=/pilot/"'));
  assert.ok(landing.includes("location.replace('/pilot/')"));
  assert.ok(landing.includes('href="/pilot/"'));
  assert.ok(!landing.includes('Testavimo vaidmuo') && !landing.includes('localStorage'));

  const entry=readFileSync(join(out,'pilot/index.html'),'utf8');
  assert.match(entry,/supabase-js/);
  assert.match(readFileSync(join(out,'_headers'),'utf8'),/no-cache/);
});

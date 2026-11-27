import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('../',import.meta.url);
test('public build stamps human release and unique commit ID, also in PWA cache',()=>{
 const temp=mkdtempSync(join(tmpdir(),'gi-release-'));
 try{
  for(const p of ['pilot','scripts','cloudflare','package.json','index.html','sw.js','manifest.webmanifest','logo.png','icon-192.png','icon-512.png','icon-192-maskable.png','icon-512-maskable.png','apple-touch-icon.png','favicon-64.png'])cpSync(new URL(p,root),join(temp,p),{recursive:true});
  const version=JSON.parse(readFileSync(join(temp,'package.json'),'utf8')).version;
  const run=(sha)=>execFileSync(process.execPath,['scripts/build-pages.mjs'],{cwd:temp,env:{...process.env,CF_PAGES_COMMIT_SHA:sha}});
  run('123456789abcdef');
  const html=()=>readFileSync(join(temp,'dist/pilot/index.html'),'utf8');
  const sw=()=>readFileSync(join(temp,'dist/pilot/sw.js'),'utf8');
  assert.ok(html().includes('v'+version+' · 12345678'));
  assert.ok(sw().includes('gi-pilot-shell-'+version+'-12345678'));
  run('abcdef0123456789');
  assert.ok(html().includes('v'+version+' · abcdef01'));
  assert.ok(sw().includes('gi-pilot-shell-'+version+'-abcdef01'));
  assert.ok(!html().includes('12345678'));
 }finally{rmSync(temp,{recursive:true,force:true});}
});

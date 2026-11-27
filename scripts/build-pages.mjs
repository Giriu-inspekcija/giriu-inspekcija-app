#!/usr/bin/env node
// Cloudflare Pages: publish ONLY approved static PWA assets.
// This repository is public and also contains SQL, tools, workflows and docs.
// Never point Pages' output directory at repository root.
import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'dist');
const required=[
  'index.html','sw.js','manifest.webmanifest','logo.png',
  'icon-192.png','icon-512.png','icon-192-maskable.png',
  'icon-512-maskable.png','apple-touch-icon.png','favicon-64.png',
  'pilot/index.html','pilot/app.js','pilot/sw.js',
  'pilot/manifest.webmanifest','pilot/privatumas.html',
  'pilot/team-thread.js','pilot/deadlines.js','pilot/document-export.js','pilot/incident-location.js',
  'pilot/vendor/fflate-0.8.2.js','pilot/vendor/fflate-LICENSE.txt'
];
const optional=['pilot/real-cases.html','pilot/real-cases.js'];
const present=optional.filter(p=>existsSync(join(root,p)));
if(present.length!==0 && present.length!==optional.length)
  throw Error('Refusing incomplete real-case page pair');
rmSync(output,{recursive:true,force:true});
for(const name of [...required,...present]){
  const src=join(root,name);
  if(!existsSync(src)||!lstatSync(src).isFile()||lstatSync(src).isSymbolicLink())
    throw Error('Missing or invalid public asset: '+name);
  const target=join(output,name);
  mkdirSync(dirname(target),{recursive:true});
  copyFileSync(src,target);
}
copyFileSync(join(root,'cloudflare','_headers'),join(output,'_headers'));
 // Version is a human release number plus an automatically generated public build ID.
const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid GI semantic version');
const digest=createHash('sha256');
for(const name of [...required,...present].sort()){
  digest.update(name+'\0');digest.update(readFileSync(join(root,name)));digest.update('\0');
}
const commit=process.env.CF_PAGES_COMMIT_SHA||process.env.GITHUB_SHA||'';
const build=/^[a-f0-9]{7,64}$/i.test(commit)?commit.slice(0,8).toLowerCase():digest.digest('hex').slice(0,8);
const pilotHtml=join(output,'pilot/index.html');
const html=readFileSync(pilotHtml,'utf8');
const versionMarker=/<span class="pilot" id="appVersion" title="Programėlės versija">v[\d.]+<\/span>/;
if(!versionMarker.test(html))throw Error('Missing GI version marker');
writeFileSync(pilotHtml,html.replace(versionMarker,
  '<span class="pilot" id="appVersion" title="Programėlės versija">v'+version+' · '+build+'</span>'));
const pilotSw=join(output,'pilot/sw.js');
const sw=readFileSync(pilotSw,'utf8');
if(!/const CACHE='gi-pilot-shell-[^']+';/.test(sw))throw Error('Missing GI cache marker');
writeFileSync(pilotSw,sw.replace(/const CACHE='gi-pilot-shell-[^']+';/,
  "const CACHE='gi-pilot-shell-"+version+"-"+build+"';"));
console.log('GI public release v'+version+' · '+build);

// Only the Cloudflare public build gets this landing redirect. The source
// index.html remains a developer demo; never let it confuse GI volunteers.
// Use a real HTML document as a safe fallback even without JavaScript.
writeFileSync(join(output,'index.html'),`<!doctype html>
<html lang="lt"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=/pilot/">
<title>Girių inspekcija – GI komanda</title>
<script>window.location.replace('/pilot/');</script>
</head><body>
<p>Atidaroma Girių inspekcijos savanorių darbo vieta…
<a href="/pilot/">Atidaryti GI komandą</a></p>
</body></html>`);
console.log('Cloudflare public bundle prepared in dist/ ('+
            (required.length+present.length+1)+' allowlisted files)');

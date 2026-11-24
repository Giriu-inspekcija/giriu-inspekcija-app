#!/usr/bin/env node
// Cloudflare Pages: publish ONLY approved static PWA assets.
// This repository is public and also contains SQL, tools, workflows and docs.
// Never point Pages' output directory at repository root.
import {copyFileSync,existsSync,lstatSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
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

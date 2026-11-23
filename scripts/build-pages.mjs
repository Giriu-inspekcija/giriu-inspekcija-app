#!/usr/bin/env node
// Cloudflare Pages: publish ONLY approved static PWA assets.
// This repository is public and also contains SQL, tools, workflows and docs.
// Never point Pages' output directory at repository root.
import {copyFileSync,existsSync,lstatSync,mkdirSync,rmSync} from 'node:fs';
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
  'pilot/team-thread.js','pilot/deadlines.js','pilot/document-export.js',
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
console.log('Cloudflare public bundle prepared in dist/ ('+
            (required.length+present.length+1)+' allowlisted files)');

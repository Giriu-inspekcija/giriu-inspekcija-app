import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const path = (name) => new URL('../' + name, import.meta.url);
const readText = (name) => readFileSync(path(name), 'utf8');
const readImage = (name) => readFileSync(path(name));

test('original approved GI logo is source of truth and generic SVG is removed', () => {
  const source = readImage('logo.png');
  const hash = createHash('sha256').update(source).digest('hex');
  assert.equal(hash, '6e6662087b4d9ebcbded51d18ae81244511b22b88e427c192b617c4f97072e50');
  assert.equal(existsSync(path('icon.svg')), false);
  assert.match(readText('scripts/generate_brand_icons.py'), /EXPECTED_SHA256/);
});

test('all official GI app icon variants are real square PNGs', () => {
  const variants = [
    ['icon-192.png',192],['icon-512.png',512],
    ['icon-192-maskable.png',192],['icon-512-maskable.png',512],
    ['apple-touch-icon.png',180],['favicon-64.png',64]
  ];
  for(const [name,size] of variants){
    const b = readImage(name);
    assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a',name);
    assert.equal(b.readUInt32BE(16),size,name+' width');
    assert.equal(b.readUInt32BE(20),size,name+' height');
    assert.ok(b.length > 2000,name+' unexpectedly small');
  }
});

test('both PWA manifests use only emblem-generated icons', () => {
  for(const manifestPath of ['manifest.webmanifest','pilot/manifest.webmanifest']){
    const m = JSON.parse(readText(manifestPath));
    const icons = m.icons;
    assert.equal(icons.length,4);
    assert.ok(icons.some(i=>i.sizes==='192x192' && i.purpose==='any'));
    assert.ok(icons.some(i=>i.sizes==='512x512' && i.purpose==='any'));
    assert.ok(icons.some(i=>i.sizes==='192x192' && i.purpose==='maskable'));
    assert.ok(icons.some(i=>i.sizes==='512x512' && i.purpose==='maskable'));
    for(const icon of icons){
      assert.match(icon.src,/icon-(?:192|512)(?:-maskable)?\.png$/);
      assert.equal(icon.type,'image/png');
    }
  }
});

test('HTML, service workers and emails do not reference placeholder logos', () => {
  for(const file of ['index.html','pilot/index.html']){
    const html=readText(file);
    assert.match(html,/<img[^>]+src="\.\.?\/logo\.png"/);
    assert.match(html,/apple-touch-icon\.png/);
    assert.match(html,/favicon-64\.png/);
    assert.doesNotMatch(html,/icon\.svg/);
  }
  for(const file of ['sw.js','pilot/sw.js']){
    const worker=readText(file);
    assert.match(worker,/icon-192-maskable\.png/);
    assert.match(worker,/apple-touch-icon\.png/);
    assert.doesNotMatch(worker,/icon\.svg/);
  }
  for(const file of ['supabase/email-templates/confirm-signup.html',
                      'supabase/email-templates/magic-link.html']){
    const html=readText(file);
    assert.match(html,/https:\/\/starlit-shortbread-a38110\.netlify\.app\/logo\.png/);
    assert.match(html,/Girių inspekcija/);
  }
});

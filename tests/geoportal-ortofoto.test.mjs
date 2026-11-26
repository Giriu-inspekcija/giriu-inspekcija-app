import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('pilot/incident-location.js'),html=read('pilot/index.html'),sw=read('pilot/sw.js');
const ctx={URLSearchParams};
const helper=js.slice(js.indexOf('  function orthoImageUrl('),js.indexOf('  function clearOrtho('));
vm.runInNewContext("const world=z=>256*2**z; const orthoService='https://www.geoportal.lt/mapproxy/rest/services/nzt_ort10lt_recent_wm/MapServer';"+helper+"; this.url=orthoImageUrl;",ctx);
test('ORT10LT uses correctly oriented EPSG:3857 bounds, not OSM XYZ numbers',()=>{
  const u=new URL(ctx.url(0,0,256,256,0));
  const b=u.searchParams.get('bbox').split(',').map(Number);
  assert.ok(Math.abs(b[0]+20037508.342789244)<1e-6);
  assert.ok(Math.abs(b[1]+20037508.342789244)<1e-6);
  assert.ok(Math.abs(b[2]-20037508.342789244)<1e-6);
  assert.ok(Math.abs(b[3]-20037508.342789244)<1e-6);
  assert.equal(u.searchParams.get('bboxSR'),'3857');
  assert.equal(u.searchParams.get('imageSR'),'3857');
  assert.equal(u.searchParams.get('size'),'256,256');
  assert.equal(new URL(ctx.url(0,0,8000,4000,16)).searchParams.get('size'),'4096,2048');
});
test('basemap switching keeps coordinates and is opt-in; failed imagery has a fallback',()=>{
  assert.doesNotThrow(()=>new Function(js));
  assert.match(html,/id="mapBasemap"[^>]+aria-pressed="false"/);
  assert.match(html,/id="mapBasemapStatus" role="status"/);
  assert.match(js,/let basemap='street'/);
  const toggle=js.slice(js.indexOf("orthoButton.addEventListener('click'"),js.indexOf('  let extras='));
  assert.match(toggle,/updateBasemap\(\);render\(\)/);
  assert.doesNotMatch(toggle,/selected\s*=|extras\s*=|input\.value\s*=|writePoint\(/);
  assert.match(js,/if\(panel.hidden\|\|basemap!=='ortho'\|\|orthoKey!==url\|\|orthoPending!==frame\)return/);
  assert.match(js,/if\(frameCovers\(orthoPending,view\)\)return/);
  assert.match(js,/img.remove\(\);orthoPending=null;orthoKey=''/);
  assert.match(js,/ORT10LT © NŽT prie AM/);
  assert.doesNotMatch(sw,/geoportal\.lt|MapServer\/export/);
  assert.match(sw,/geoportal/);
});
// One small public view request on the integration PR, never in regular tests,
// never using volunteer or case coordinates. Failing service blocks promotion.
test('live Geoportal view returns a JPEG', {skip:process.env.GITHUB_HEAD_REF!=='feature/geoportal-ortofoto',timeout:25000},async()=>{
  const z=15,n=256*2**z,lon=24,lat=55.2,s=Math.sin(lat*Math.PI/180);
  const x=(lon+180)/360*n,y=(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n;
  const r=await fetch(ctx.url(x-128,y-128,256,256,z),{signal:AbortSignal.timeout(20000),headers:{Referer:'https://komanda.giriuinspekcija.lt/'}});
  assert.equal(r.status,200);
  assert.match(r.headers.get('content-type')||'',/^image\/(jpeg|jpg)/i);
  const b=new Uint8Array(await r.arrayBuffer());
  assert.ok(b.length>100&&b[0]===255&&b[1]===216,'must be a real JPEG image');
});

test('buffered ortho remains aligned on pan and retains previous loaded image until replacement',()=>{
  const funcs=js.slice(js.indexOf('  function frameCovers('),js.indexOf('  function cancelOrthoPending('));
  const c={};vm.runInNewContext(funcs+';this.bounds=frameBounds;this.covers=frameCovers;this.position=positionOrtho;',c);
  const view={left:1000.25,top:2000.75,w:320,h:300,z:16,period:'recent'};
  const frame=c.bounds(view);frame.img={style:{}};
  assert.equal(c.covers(frame,view),true);
  assert.equal(c.covers(frame,{...view,left:view.left+40}),true);
  assert.equal(c.covers(frame,{...view,left:view.left+100}),false);
  assert.equal(c.covers(frame,{...view,z:17}),false);
  assert.equal(c.covers(frame,{...view,period:'2018-2020'}),false);
  c.position(frame,view);assert.equal(parseFloat(frame.img.style.left),frame.left-view.left);
  c.position(frame,{...view,left:view.left+40});assert.equal(parseFloat(frame.img.style.left),frame.left-view.left-40);
  c.position(frame,{...view,z:17,left:2*view.left,top:2*view.top});assert.equal(parseFloat(frame.img.style.width),2*frame.w);
  const render=js.slice(js.indexOf('  function renderOrtho('),js.indexOf('  function updateBasemap('));
  assert.doesNotMatch(render,/tiles\.replaceChildren/);
  assert.match(render,/img.style.visibility='hidden'/);
  assert.match(render,/img.style.visibility='visible';old\?\.img.remove\(\)/);
});

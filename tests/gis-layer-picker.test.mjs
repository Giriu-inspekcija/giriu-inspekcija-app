import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('pilot/incident-location.js'),html=read('pilot/index.html'),sw=read('pilot/sw.js');
const ctx={URLSearchParams,URL};
const helper=js.slice(js.indexOf('  function orthoImageUrl('),js.indexOf('  function clearOrtho('));
const overlay=js.slice(js.indexOf('  function overlayImageUrl('),js.indexOf('  function renderOverlays('));
vm.runInNewContext("const world=z=>256*2**z; const orthoService='https://www.geoportal.lt/mapproxy/rest/services/nzt_ort10lt_recent_wm/MapServer'; const geoRoot='https://www.geoportal.lt/mapproxy/rest/services/';"+helper+overlay+";this.ortho=orthoImageUrl;this.overlay=overlayImageUrl;",ctx);
test('GIS controls are opt-in, visible, correctly labelled and keep all points',()=>{
  assert.doesNotThrow(()=>new Function(js));
  for(const k of ['parcels','kmb','groups','state','habitats','restrictions']){
    assert.match(html,new RegExp('id="layer-'+k+'" type="checkbox"'));
  }
  assert.match(html,/id="mapLayersToggle" aria-expanded="false"/);
  assert.match(html,/id="mapLayerMenu" hidden/);
  assert.match(html,/value="2024-2026">2024/);
  assert.match(html,/value="2021-2023" disabled/);
  assert.match(html,/Inventorizuotos EB buveinės \(2011–2014 m\.\)/);
  assert.match(js,/if\(zoom<12\)/);
  assert.match(js,/if\(panel.hidden\|\|overlayKey!==key\)return/);
  assert.match(js,/renderOverlays\(left,top,w,h\)/);
  assert.doesNotMatch(sw,/geoportal\.lt/);
  const change=js.slice(js.indexOf("periodControl.addEventListener('change'"),js.indexOf('  const orthoButton='));
  assert.doesNotMatch(change,/selected\s*=|extras\s*=|input\.value\s*=|writePoint\(/);
});
test('overlay exports use the same aligned extent, selected IDs and transparent images',()=>{
  const b=new URL(ctx.ortho(10,20,300,200,16));
  const u=new URL(ctx.overlay('vmt_miskai',[3,7],10,20,300,200,16));
  for(const k of ['bbox','bboxSR','imageSR','size'])assert.equal(u.searchParams.get(k),b.searchParams.get(k));
  assert.equal(u.searchParams.get('format'),'png32');
  assert.equal(u.searchParams.get('transparent'),'true');
  assert.equal(u.searchParams.get('layers'),'show:3,7');
});
test('GIS official view services respond with real images', {skip:process.env.GITHUB_HEAD_REF!=='feature/gis-layer-picker',timeout:60000},async()=>{
  const z=14,n=256*2**z,lat=55.2,lon=24,s=Math.sin(lat*Math.PI/180);
  const x=(lon+180)/360*n-128,y=(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n-128;
  const urls=[
    ctx.ortho(x,y,256,256,z,'https://www.geoportal.lt/mapproxy/rest/services/nzt_ort10lt_2024_2026/MapServer'),
    ...[['vmt_mkd',[0,1]],['vmt_miskai',[3,7,8]],['am_bigis_spalvotas',[]],['vstt_natura_apribojimai',[0,1,2,3]]].map(([service,ids])=>ctx.overlay(service,ids,x,y,256,256,z))
  ];
  for(const url of urls){
    const r=await fetch(url,{signal:AbortSignal.timeout(10000),headers:{Referer:'https://komanda.giriuinspekcija.lt/'}});
    assert.equal(r.status,200,url);
    assert.match(r.headers.get('content-type')||'',/^image\/(jpeg|jpg|png)/i,url);
    const b=new Uint8Array(await r.arrayBuffer());
    assert.ok(b.length>100&&((b[0]===255&&b[1]===216)||(b[0]===137&&b[1]===80)),url);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('pilot/incident-location.js'),html=read('pilot/index.html'),sw=read('pilot/sw.js');
const ctx={URLSearchParams,URL};
const helper=js.slice(js.indexOf('  function orthoImageUrl('),js.indexOf('  function clearOrtho('));
const overlay=js.slice(js.indexOf('  function overlayImageUrl('),js.indexOf('  function vectorQueryUrl('));
vm.runInNewContext("const world=z=>256*2**z; const orthoService='https://www.geoportal.lt/mapproxy/rest/services/nzt_ort10lt_recent_wm/MapServer'; const geoRoot='https://www.geoportal.lt/mapproxy/rest/services/';"+helper+overlay+";this.ortho=orthoImageUrl;this.overlay=overlayImageUrl;",ctx);
test('GIS controls are opt-in, visible, correctly labelled and keep all points',()=>{
  assert.doesNotThrow(()=>new Function(js));
  for(const k of ['old120','old180','permits','parcels','kmb','groups','state','habitats','restrictions']){
    assert.match(html,new RegExp('id="layer-'+k+'" type="checkbox"'));
  }
  assert.match(html,/id="mapLayersToggle" aria-expanded="false"/);
  assert.match(html,/id="mapLayerMenu" hidden/);
  assert.match(html,/value="2024-2026">2024/);
  for(const p of ["2021-2023","2018-2020","2015-2017","2012-2013","2009-2010","2005-2006","1995-1999"])assert.ok(html.includes('value="'+p+'">'));
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
test('GIS official view services respond with real images', {skip:process.env.GITHUB_HEAD_REF!=='feature/gis-layer-picker',timeout:180000},async()=>{
  const z=14,n=256*2**z,lat=55.2,lon=24,s=Math.sin(lat*Math.PI/180);
  const x=(lon+180)/360*n-128,y=(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n-128;
  const urls=[
    ctx.ortho(x,y,256,256,z,'https://www.geoportal.lt/mapproxy/rest/services/nzt_ort10lt_2024_2026/MapServer'),
    ...['2021_2023','2018_2020','2015_2017','2012_2013','2009_2010','2005_2006','1995_2001'].map(p=>ctx.ortho(x,y,256,256,z,'https://www.geoportal.lt/mapproxy/nzt_ort10lt_'+p+'/MapServer')),
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

const vectorHelper=js.slice(js.indexOf('  function vectorQueryUrl('),js.indexOf('  function featurePath('));
vm.runInNewContext("const world=z=>256*2**z;"+vectorHelper+";this.query=vectorQueryUrl;",ctx);
test('public vector queries use visible extent and published stand age in years',()=>{
  const u=new URL(ctx.query('https://example.invalid/query','AMZ >= 180','AMZ',10,20,300,200,16));
  assert.equal(u.searchParams.get('where'),'AMZ >= 180');
  assert.equal(u.searchParams.get('inSR'),'3857');
  assert.equal(u.searchParams.get('outSR'),'4326');
  assert.equal(u.searchParams.get('resultRecordCount'),'1000');
  assert.match(js,/data\.exceededTransferLimit/);
  assert.match(js,/controller\.signal\.aborted/);
  assert.match(js,/age>=180/);
});
test('live VMT age and permit geometry endpoints return GeoJSON', {skip:process.env.GITHUB_HEAD_REF!=='feature/gis-layer-picker',timeout:50000},async()=>{
  const z=13,n=256*2**z,lat=55.0693,lon=23.7525,s=Math.sin(lat*Math.PI/180);
  const x=(lon+180)/360*n-128,y=(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n-128;
  const stand='https://www.geoportal.lt/mapproxy/vmt_mkd/MapServer/1/query';
  const permits='https://services6.arcgis.com/9d0vtWtIrdsf4pvs/arcgis/rest/services/lkmp_data/FeatureServer/0/query';
  for(const [endpoint,where,fields] of [[stand,'AMZ >= 120','AMZ'],[stand,'AMZ >= 180','AMZ'],[permits,'1=1','id']]){
    const url=ctx.query(endpoint,where,fields,x,y,256,256,z);
    const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{Origin:'https://komanda.giriuinspekcija.lt',Referer:'https://komanda.giriuinspekcija.lt/'}});
    assert.equal(r.status,200,url);
    const cors=r.headers.get('access-control-allow-origin');
    assert.ok(cors==='*'||cors==='https://komanda.giriuinspekcija.lt','Browser CORS: '+endpoint);
    const d=await r.json();
    assert.equal(d.type,'FeatureCollection',JSON.stringify(d.error));
    assert.ok(Array.isArray(d.features)&&d.features.length>0,'Expected known GIS data in test extent');
    assert.ok(d.features.every(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type)));
    if(fields==='AMZ')assert.ok(d.features.every(f=>Number(f.properties.AMZ)>=Number(where.split(' ').at(-1))));
  }
});

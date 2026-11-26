import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('pilot/incident-location.js'),html=read('pilot/index.html');
const ctx={URLSearchParams};
vm.runInNewContext(js.slice(js.indexOf('  const groupDefs='),js.indexOf('  async function queryAt('))+';this.classify=classifyGroup;this.defs=groupDefs;this.point=pointQueryUrl;',ctx);
test('separate official forest groups including IIA/IIB and unknown codes',()=>{
  for(const [g,p,k] of [[1,10,'group1'],[2,21,'group2a'],[2,24,'group2a'],[2,25,'group2b'],[2,29,'group2b'],[3,31,'group3'],[4,41,'group4'],[2,0,null],[null,null,null]]){
    assert.equal(ctx.classify({grupe:g,pogrupis:p}),k);
  }
  for(const k of Object.keys(ctx.defs))assert.match(html,new RegExp('id="layer-'+k+'" type="checkbox"'));
  const url=new URL(ctx.point('https://example.invalid/query',[55.123,24.456],'grupe,pogrupis'));
  assert.equal(url.searchParams.get('geometry'),'24.456,55.123');
  assert.equal(url.searchParams.get('geometryType'),'esriGeometryPoint');
  assert.equal(url.searchParams.get('returnGeometry'),'false');
});
test('inspection cannot change incident coordinates and detail card remains optional',()=>{
  const choose=js.slice(js.indexOf('  function choose(p)'),js.indexOf('  function sync('));
  assert.match(choose,/if\(inspectMode\)\{inspected=p;showPointInfo\(p,[^;]+;render\(\);return;\}/);
  assert.ok(choose.indexOf('if(inspectMode)')<choose.indexOf('writePoint(p,index)'));
  assert.match(html,/id="mapInspect"[^>]*aria-pressed="false"/);
  assert.match(html,/id="forestInfoCard" hidden/);
  assert.match(html,/id="forestInfoDetails"><summary>Daugiau informacijos/);
  assert.match(js,/if\(!inspectMode\)showPointInfo\(p,'Įvykio taškas '/);
  assert.match(js,/if\(!infoPoint\|\|!infoDetails.open/);
  assert.match(js,/if\(infoKey!==key\|\|controller.signal.aborted\)return/);
  assert.match(js,/forestInfoOutside'\)\.append\(infoCard\)/);
  assert.match(js,/forestInfoInside'\)\.append\(infoCard\)/);
});
test('official group service verifies actual layer schema, group codes and point lookup', {skip:process.env.GITHUB_HEAD_REF!=='feature/forest-location-inspector',timeout:60000},async()=>{
  const base='https://www.geoportal.lt/mapproxy/vmt_miskai/MapServer/7';
  const origin='https://komanda.giriuinspekcija.lt';
  async function get(u){
    const r=await fetch(u,{headers:{Origin:origin},signal:AbortSignal.timeout(12000)});
    assert.equal(r.status,200,u);
    const cors=r.headers.get('access-control-allow-origin');assert.ok(cors==='*'||cors===origin,'CORS '+u);
    const d=await r.json();assert.ok(!d.error,u+' '+JSON.stringify(d.error));return d;
  }
  const m=await get(base+'?f=json');
  assert.match(m.name,/grup/i);
  assert.ok(['grupe','pogrupis'].every(k=>m.fields.some(f=>f.name===k)),JSON.stringify(m.fields));
  const p=[55.069306,23.752473];
  const group=await get(ctx.point(base+'/query',p,'grupe,pogrupis'));
  assert.ok(Array.isArray(group.features)&&group.features.length>0,'Known forest point not returned');
  assert.ok(group.features.some(f=>ctx.classify(f.attributes)),JSON.stringify(group.features));
  const stand=await get(ctx.point('https://www.geoportal.lt/mapproxy/vmt_mkd/MapServer/1/query',p,'AMZ,kv_nr,skl_nr'));
  assert.ok(Array.isArray(stand.features)&&stand.features.length>0);
  const url=base+'/query?'+new URLSearchParams({f:'json',where:'grupe IN (1,2,3,4)',geometry:'23.74,55.06,23.76,55.08',geometryType:'esriGeometryEnvelope',inSR:'4326',outSR:'4326',outFields:'grupe,pogrupis,OBJECTID',returnGeometry:'true',spatialRel:'esriSpatialRelIntersects'});
  const view=await get(url);
  assert.ok(view.features.some(f=>f.geometry?.rings?.length&&ctx.classify(f.attributes)));
});

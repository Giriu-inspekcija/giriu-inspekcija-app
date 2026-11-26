import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('pilot/incident-location.js'),html=read('pilot/index.html');
test('fullscreen keeps map independent of expandable information sheet and quick filters',()=>{
 assert.match(html,/\.map-fullscreen \.map-frame\{position:absolute;inset:0/);
 assert.match(html,/\.map-fullscreen #incidentMap\{height:100%;width:100%/);
 assert.match(html,/\.map-fullscreen \.map-sheet\{max-height:28dvh;overflow:auto/);
 const quick=html.slice(html.indexOf('class="map-quick-layers"'),html.indexOf('class="map-sheet"'));
 for(const k of ['permits','old120','old180']){
  assert.match(quick,new RegExp('id="layer-'+k+'" type="checkbox"'));
  assert.equal((html.match(new RegExp('id="layer-'+k+'"','g'))||[]).length,1);
 }
 assert.match(html,/<dt>Nuosavybė<\/dt><dd id="forestInfoState"/);
 assert.match(html,/<dt>Vyraujanti rūšis<\/dt><dd id="forestInfoSpecies"/);
 assert.match(js,/AMZ,VMR,kv_nr,skl_nr/);
});
test('stand species and age use data only; missing age never invented',()=>{
 const c={};vm.runInNewContext(js.slice(js.indexOf('  function describeStand('),js.indexOf('  function showPointInfo('))+';this.describe=describeStand;',c);
 assert.equal(c.describe([{VMR:'Pušis',AMZ:156,kv_nr:2,skl_nr:3}]).species,'Pušis');
 assert.equal(c.describe([{VMR:'',AMZ:0}]).age,'Amžius nenurodytas');
 assert.equal(c.describe([{VMR:'',AMZ:0}]).species,'Rūšis nenurodyta');
 const o={};vm.runInNewContext(js.slice(js.indexOf('  function ownershipLabel('),js.indexOf('  async function permitOwnershipField('))+';this.label=ownershipLabel;',o);
 assert.equal(o.label('Privati'),'Privatus');assert.equal(o.label('Valstybinė'),'Valstybinis');assert.equal(o.label('unknown'),null);
 assert.match(js,/if\(stateHit\)return 'Valstybinis \(VRM\)'/);
 assert.match(js,/return 'Nenustatyta'/);
});
test('live forest data and ownership metadata', {skip:process.env.GITHUB_HEAD_REF!=='fix/fullscreen-forest-card',timeout:45000},async()=>{
 const origin='https://komanda.giriuinspekcija.lt';
 async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{Origin:origin}});assert.equal(r.status,200);const d=await r.json();assert.ok(!d.error,JSON.stringify(d.error));return d;}
 const stand='https://www.geoportal.lt/mapproxy/vmt_mkd/MapServer/1/query?'+new URLSearchParams({f:'json',where:'1=1',geometry:'23.752473,55.069306',geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'AMZ,VMR,kv_nr,skl_nr',returnGeometry:'false'});
 const s=await get(stand);assert.ok(s.features.length);console.log('VMR sample:',s.features.map(f=>f.attributes.VMR));
 const base='https://services6.arcgis.com/9d0vtWtIrdsf4pvs/arcgis/rest/services/lkmp_data/FeatureServer/0';
 const m=await get(base+'?f=json');console.log('permit metadata:',JSON.stringify(m.fields.map(f=>({name:f.name,alias:f.alias,domain:f.domain}))));
 const fields=m.fields.filter(f=>/nuosav|ownership|nuosavyb/i.test(f.name+' '+f.alias));
 if(fields.length){const f=fields.find(f=>/forma|type|tipas/i.test(f.name+' '+f.alias))||fields[0];
 const d=await get(base+'/query?'+new URLSearchParams({f:'json',where:'1=1',geometry:'24.591938,55.147987',geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'id,'+f.name,returnGeometry:'false'}));console.log('ownership values:',JSON.stringify(d.features.map(x=>x.attributes[f.name])));}
});

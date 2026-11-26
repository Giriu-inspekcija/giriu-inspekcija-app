import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('pilot/incident-location.js'),html=read('pilot/index.html');
const ctx={};
vm.runInNewContext(js.slice(js.indexOf('  function attribute('),js.indexOf('  function paintProtection('))+';this.describe=protectionText;',ctx);
test('protection entries show actual names and codes, not yes/no',()=>{
 assert.equal(ctx.describe('park',{pavadinimas:'Aukštaitijos nacionalinis parkas'}),'Aukštaitijos nacionalinis parkas');
 assert.equal(ctx.describe('reserve',{pavadinimas:'Draustinio pavadinimas'}),'Draustinio pavadinimas');
 assert.equal(ctx.describe('bast',{pavadinimas:'Miškas',sitecode:'LTTEST001'}),'Miškas · LTTEST001');
 assert.match(ctx.describe('kmb',{KMB_tip_kod:'A1',KMB_nr:'123'}),/A1.*123/);
 assert.match(ctx.describe('eb',{buv_kodas:'9010*',buv_pav:'Vakarų taiga'}),/9010\*.*Vakarų taiga/);
 assert.match(html,/id="forestProtectionDetails" hidden/);
 assert.match(js,/details.hidden=!lines.length&&!failed.length/);
 assert.match(js,/if\(infoKey!==key\|\|controller.signal.aborted\)return;\s*paintProtection/);
 assert.match(js,/void loadProtection\(p,controller,key\)/);
 assert.match(html,/Inventorizuotos EB buveinės savaime nepatvirtina apsaugos statuso/);
});
test('official STVK, KMB and EB polygon point sources are browser accessible', {skip:process.env.GITHUB_HEAD_REF!=='feature/protection-point-summary',timeout:90000},async()=>{
 const stvk='https://osp-sdg.stat.gov.lt/arcgis/rest/services/vstt_stvk/MapServer/';
 const geo='https://www.geoportal.lt/mapproxy/';
 const sources=[
 ['bast',stvk+'5'],['past',stvk+'14'],['park',stvk+'13'],['reserve',stvk+'6'],['strict',stvk+'15'],
 ['kmb',geo+'vmt_miskai/MapServer/3'],['eb',geo+'am_bigis_spalvotas/MapServer/2']];
 const origin='https://komanda.giriuinspekcija.lt';
 async function get(url){
   const r=await fetch(url,{headers:{Origin:origin},signal:AbortSignal.timeout(12000)});
   assert.equal(r.status,200,url);
   const cors=r.headers.get('access-control-allow-origin');
   assert.ok(cors==='*'||cors===origin,'Browser CORS: '+url+' '+cors);
   const d=await r.json();assert.ok(!d.error,url+' '+JSON.stringify(d.error));return d;
 }
 await Promise.all(sources.map(async([kind,base])=>{
   const m=await get(base+'?f=json');
   console.log('protection schema',kind,JSON.stringify(m.fields?.map(f=>({name:f.name,alias:f.alias,domain:f.domain}))));
   assert.ok(m.fields?.length,kind);
   const q=base+'/query?'+new URLSearchParams({f:'json',where:'1=1',geometry:'24.0,55.2',geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'*',returnGeometry:'false'});
   const d=await get(q);assert.ok(Array.isArray(d.features),kind);
   const sample=await get(base+'/query?'+new URLSearchParams({f:'json',where:'1=1',outFields:'*',returnGeometry:'false',resultRecordCount:'1'}));
   console.log('protection sample',kind,JSON.stringify(sample.features?.[0]?.attributes||{}).slice(0,3500));
 }));
});

test('permit detail rows include verified type and dates; do not invent issue date',()=>{
 const c={Intl,Date};vm.runInNewContext(js.slice(js.indexOf('  function attribute('),js.indexOf('  function protectionText('))+js.slice(js.indexOf('  function permitDate('),js.indexOf('  function paintPermits('))+';this.facts=permitFacts;',c);
 const rows=Object.fromEntries(c.facts({id:123,kirtimo_rusis:'Plynasis',galioja_nuo:Date.UTC(2026,0,2),galioja_iki:Date.UTC(2026,11,31)}));
 assert.equal(rows['Nr.'],'123');assert.equal(rows['Kirtimo rūšis'],'Plynasis');assert.ok(rows['Galioja nuo']);assert.ok(rows['Galioja iki']);assert.equal(rows['Išduotas'],undefined);
 assert.match(html,/id="forestPermitDetails" hidden/);
 assert.match(js,/details.hidden=!rows.length&&!failed/);
});

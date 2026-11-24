import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=read('pilot/app.js'),html=read('pilot/index.html'),sw=read('pilot/sw.js'),loc=read('pilot/incident-location.js'),build=read('scripts/build-pages.mjs');
test('GPS explicitly selects best fix without a second button',()=>{
 assert.match(loc,/navigator\.geolocation\.watchPosition/);
 assert.match(loc,/enableHighAccuracy:true,timeout:20000,maximumAge:0/);
 const gps=loc.slice(loc.indexOf("gps.addEventListener('click'"),loc.indexOf("function openMapAt"));
 assert.doesNotMatch(gps,/fetch\(|localStorage|sessionStorage/);
 assert.match(gps,/input\.value=format\(selected\)/);
 assert.doesNotMatch(html,/id="incidentUseGps"/);
 assert.match(loc,/accuracy<best\.accuracy/);
 assert.match(loc,/clearWatch/);
 assert.match(loc,/selected=\[\.\.\.best\.point\]/);
 assert.match(html,/id="mapGpsDot"/);
 assert.match(loc,/token!==generation/);
 assert.ok(app.includes('incidentLocation.reset()'));
});
test('map is opt-in, attributed, and chooses synthetic coordinates',()=>{
 assert.match(loc,/if\(panel\.hidden\)return/);
 assert.match(loc,/tile\.openstreetmap\.org/);
 assert.match(loc,/input\.value=format\(p\)/);
 assert.match(html,/© OpenStreetMap contributors/);
 assert.match(html,/id="incidentMapPanel" hidden/);
 assert.match(loc,/pointerup/);
 assert.match(loc,/ArrowLeft/);
 assert.match(sw,/incident-location\.js/);
 assert.match(build,/pilot\/incident-location\.js/);
 assert.doesNotMatch(sw,/tile\.openstreetmap\.org/);
});

test('map moves with pointer and reuses still visible tiles',()=>{
 assert.match(loc,/pointermove/);
 assert.match(loc,/shift\(e.clientX-drag.x,e.clientY-drag.y\)/);
 assert.match(loc,/tileNodes.get\(key\)/);
 assert.doesNotMatch(loc,/replaceChildren\(\.\.\.nodes\)/);
 assert.match(html,/Ribotas duomenų režimas/);
});

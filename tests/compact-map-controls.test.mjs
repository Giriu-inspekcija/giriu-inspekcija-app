import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('pilot/incident-location.js'),html=read('pilot/index.html');
test('compact map controls can be hidden and restored without changing GIS selections',()=>{
 assert.match(html,/id="mapSheetToggle"[^>]*aria-expanded="true"[^>]*aria-controls="mapControlsContent"/);
 assert.match(html,/id="mapControlsContent"/);
 assert.match(js,/content.hidden=collapsed;toggle.setAttribute\('aria-expanded',String\(!collapsed\)\)/);
 const toggle=js.slice(js.indexOf('  function setSheetCollapsed('),js.indexOf("  el('mapSheetToggle').addEventListener"));
 assert.doesNotMatch(toggle,/selectedLayers|selected=|render\(|clearOverlays/);
 assert.match(html,/\.map-controls\{display:block;min-width:0;width:100%/);
 assert.match(html,/\.map-bottom\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\) auto/);
});
test('forest details have independent colors and copy coordinates from inspected point',()=>{
 for(const k of ['forest-main','forest-protection','forest-permits'])assert.match(html,new RegExp('\\.'+k+'\\{background:'));
 assert.match(html,/id="forestMainDetails" class="forest-block forest-main"/);
 assert.match(html,/id="forestCopyCoords"[^>]*aria-label="Kopijuoti koordinates"/);
 assert.match(js,/const value=format\(p\),out=el\('forestCopyStatus'\)/);
 assert.match(js,/navigator.clipboard.writeText\(value\)/);
 assert.match(js,/forestMainDetails'\)\.open=false/);
 assert.match(js,/const minAge=selectedLayers.has\('old120'\)\?120:180/);
 assert.match(js,/AMZ >= /);
});

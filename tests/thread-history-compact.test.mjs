import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../pilot/team-thread.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  function historyItems(items){'),source.indexOf('  async function open('));
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const render=vm.runInNewContext(code+'\n({historyItems,contributionLabel})',{html,when:()=> '17:15',entryName:{help:'Prisijungė padėti'}});
test('history entry is collapsed, includes actor and timestamp; content safely escaped',()=>{
  const result=render.historyItems([{label:'Vilija · Papildė informaciją',at:0,body:'<script>test</script>'}]);
  assert.match(result,/<details class="thread-history-entry"><summary><b>Vilija · Papildė informaciją<\/b><time class="small">17:15<\/time><\/summary>/);
  assert.match(result,/&lt;script&gt;test&lt;\/script&gt;/);
  assert.doesNotMatch(result,/<details[^>]*\bopen\b|<script>/);
});
test('document/photo contribution is distinguished and attachment remains clickable',()=>{
  assert.equal(render.contributionLabel({kind:'note',attachment:'x.pdf',filename:'Leidimas.PDF'}),'Pridėjo dokumentą');
  assert.equal(render.contributionLabel({kind:'note',attachment:'x.jpg',filename:'Vieta.jpg'}),'Pridėjo nuotrauką');
  assert.equal(render.contributionLabel({kind:'note',body:'Papildymas'}),'Papildė informaciją');
  assert.equal(render.contributionLabel({kind:'help'}),'Prisijungė padėti');
  assert.match(render.historyItems([{label:'Pridėjo dokumentą',at:0,file:'x.pdf',name:'Leidimas.pdf'}]),/data-file="x.pdf">Leidimas.pdf/);
});
test('events without body stay compact; existing actor name is used',()=>{
  assert.doesNotMatch(render.historyItems([{label:'Pradėta patikra',at:0}]),/<details/);
  assert.match(source,/e\.actor_name.*contributionLabel\(e\)/);
  assert.match(source,/history\.slice\(0,5\)/);
});

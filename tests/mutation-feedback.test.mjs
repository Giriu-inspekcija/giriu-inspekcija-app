import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../pilot/app.js',import.meta.url),'utf8');
const start=app.indexOf("  async function run(call,successMessage='Veiksmas išsaugotas.') {");
const end=app.indexOf('  async function onSignIn() {',start);
assert.ok(start>=0 && end>start,'The mutation handler must exist');
const source=app.slice(start,end);

function harness({refresh=async()=>true,online=true}={}){
  const messages=[],notices=[];
  let writes=0,refreshes=0;
  const context={
    mutationInFlight:false,navigator:{onLine:online},lastControl:null,
    document:{activeElement:null},busy:()=>()=>{},
    toast:(message,error=false)=>messages.push({message,error}),
    notice:(message,error=false)=>notices.push({message,error}),
    loading:false,refreshFinished:Promise.resolve(),
    refreshWorkspace:async()=>{refreshes++;return refresh();},
    expiredSession:()=>false,endExpiredSession:()=>{}
  };
  const run=vm.runInNewContext([source,'run'].join(String.fromCharCode(10)),context);
  const call=async()=>{writes++;return {data:{}};};
  return {run,call,messages,notices,counts:()=>({writes,refreshes})};
}

test('confirmed write remains successful when the UI refresh returns false',async()=>{
  const h=harness({refresh:async()=>false});
  assert.equal(await h.run(h.call,'Užduotis išsaugota.'),true);
  assert.deepEqual(h.counts(),{writes:1,refreshes:1});
  assert.ok(h.messages.some(m=>m.message==='Užduotis išsaugota.'&&!m.error));
  assert.ok(h.notices.some(n=>n.message.includes('išsaugotas serveryje')&&n.message.includes('Nekartokite')));
});

test('confirmed write remains successful when UI refresh throws',async()=>{
  const h=harness({refresh:async()=>{throw Error('connection dropped');}});
  assert.equal(await h.run(h.call,'Pranešimas pateiktas.'),true);
  assert.deepEqual(h.counts(),{writes:1,refreshes:1});
  assert.ok(h.notices.some(n=>n.message.includes('išsaugotas serveryje')));
});

test('failed write does not claim success or refresh stale data',async()=>{
  const h=harness();
  assert.equal(await h.run(async()=>{throw Error('permission denied');} ),false);
  assert.deepEqual(h.counts(),{writes:0,refreshes:0});
  assert.ok(h.messages.some(m=>m.error&&m.message.includes('Nepavyko atlikti veiksmo')));
  assert.equal(h.notices.some(n=>n.message.includes('išsaugotas serveryje')),false);
});

test('double click never performs a second write',async()=>{
  const h=harness();
  let finish;
  const gate=new Promise(resolve=>{finish=resolve;});
  let calls=0;
  const first=h.run(async()=>{calls++;await gate;return {data:null};});
  assert.equal(await h.run(async()=>{calls++;return {data:null};}),false);
  finish();
  assert.equal(await first,true);
  assert.equal(calls,1);
});

test('offline click does not send a write',async()=>{
  const h=harness({online:false});
  assert.equal(await h.run(h.call),false);
  assert.deepEqual(h.counts(),{writes:0,refreshes:0});
  assert.ok(h.messages.some(m=>m.error&&m.message.includes('Nėra interneto ryšio')));
});

'use strict';
window.giTeamThread=function({client,user,isStaff,role,html,when,statuses,actions,categories,busy,ask,copyText,refresh}){
  const el=id=>document.getElementById(id), dialog=el('threadDialog'), content=el('threadContent');
  const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const mime={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};
  const kindName={incident:'Įvykis',task:'Užduotis'};
  const entryName={help:'Prisijungė padėti',shared:'Atvėrė kortelę komandai',restricted:'Apribojo kortelės matomumą',note:'Papildė informaciją'};
  const files=()=>client.storage.from('gi-thread-files');
  let active=null,revision=0,working=false,checking=false;
  const read=async query=>{const {data,error}=await query;if(error)throw error;return data;};
  function link(kind,id){
    const url=new URL(location.pathname,location.origin);
    url.searchParams.set(kind,id);return url.href;
  }
  function route(){
    const params=new URLSearchParams(location.search);
    for(const k of Object.keys(kindName)){const id=params.get(k);if(uuid.test(id||''))return {kind:k,id};}
  }
  const returnKey='gi-thread-login-return';
  function rememberRoute(){
    try{
      const target=route();
      if(target)sessionStorage.setItem(returnKey,JSON.stringify({...target,expires:Date.now()+900000}));
      else sessionStorage.removeItem(returnKey);
    }catch{}
  }
  function afterLogin(){
    let saved=null;
    try{
      saved=JSON.parse(sessionStorage.getItem(returnKey)||'null');
      sessionStorage.removeItem(returnKey);
    }catch{}
    if(route()||!saved||!Object.hasOwn(kindName,saved.kind)||!uuid.test(saved.id)||!(saved.expires>Date.now()))return;
    history.replaceState(null,'',link(saved.kind,saved.id));
  }
  function clear(){
    revision++;active=null;working=false;
    if(dialog.open)dialog.close();
    el('threadTitle').textContent='';content.replaceChildren();el('threadStatus').textContent='';
  }
  function hasDraft(){
    return Array.from(content.querySelectorAll('textarea,input')).some(e=>e.type==='file'?e.files.length>0:e.value.trim()!=='');
  }
  async function mayLeave(){
    return !hasDraft()||await ask('Kortelėje yra nepaskelbtas tekstas arba priedas.',{action:'Išeiti neišsaugojus'});
  }
  async function close(){
    if(working||!await mayLeave())return;
    const url=new URL(location.href);
    url.searchParams.delete('incident');url.searchParams.delete('task');history.replaceState(null,'',url);clear();
  }
  el('closeThread').onclick=close;
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  async function allPages(makeQuery){
    const result=[];
    for(let start=0;;start+=100){
      const page=await read(makeQuery().range(start,start+99));result.push(...page);
      if(page.length<100)return result;
    }
  }
  function threadLink(kind,id,title){
    return '<a class="thread-title" href="'+html(link(kind,id))+'" data-thread="'+kind+'" data-key="'+html(id)+'">'+html(title)+'</a>';
  }
  function historyItems(items){
    return items.map(h=>{
      const headline='<b>'+html(h.label)+'</b><time class="small">'+html(when(h.at))+'</time>';
      const content=(h.body?'<p>'+html(h.body)+'</p>':'')+(h.url||'')
        +(h.file?'<button type="button" class="outline" data-file="'+html(h.file)+'">'+html(h.name||'Priedas')+'</button>':'');
      return '<li>'+(content?'<details class="thread-history-entry"><summary>'+headline+'</summary><div class="thread-history-content">'+content+'</div></details>':headline)+'</li>';
    }).join('');
  }
  function coordinateLine(lat,lon){
    if(!String(lat??'').trim()||!String(lon??'').trim())return null;
    const a=Number(lat),b=Number(lon);
    return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180
      ?'Koordinatės: '+a.toFixed(6)+', '+b.toFixed(6):null;
  }
  function pointFromNote(body){
    const match=String(body??'').match(/^Koordinatės: (-?\d{1,3}\.\d{6}), (-?\d{1,3}\.\d{6})(?:\n|$)/);
    return match&&coordinateLine(match[1],match[2])===match[0].trimEnd()?match[1]+', '+match[2]:null;
  }
  function contributionLabel(entry){
    if(entry.kind!=='note')return entryName[entry.kind]||'Papildė informaciją';
    if(entry.incident_id&&pointFromNote(entry.body))return 'Pridėjo koordinates';
    if(entry.attachment){
      if(/\.pdf$/i.test(entry.filename||entry.attachment))return 'Pridėjo dokumentą';
      if(/\.(jpg|jpeg|png|webp)$/i.test(entry.filename||entry.attachment))return 'Pridėjo nuotrauką';
      return 'Pridėjo priedą';
    }
    return 'Papildė informaciją';
  }
  async function open(kind,id,changeUrl=true){
    if(!user()||!Object.hasOwn(kindName,kind)||!uuid.test(id))return;
    if(changeUrl)history.replaceState(null,'',link(kind,id));
    const view={kind,id,actor:user().id,request:crypto.randomUUID()};
    active=view;const version=++revision;
    const current=()=>version===revision&&user()?.id===view.actor;
    const incident=kind==='incident',key=incident?'incident_id':'task_id';
    el('threadName').textContent=kindName[kind];el('threadTitle').textContent='Kraunama…';
    content.replaceChildren();el('threadStatus').textContent='';
    if(!dialog.open)dialog.showModal();
    dialog.scrollTop=0;
    try{
      const row=await read(client.from(incident?'gi_incidents':'gi_tasks').select('*').eq('id',id).maybeSingle());
      if(!current())return;
      if(!row)throw Error('Ši kortelė jūsų paskyrai neprieinama. Dėl prieigos kreipkitės į koordinatorių.');
      const [updates,events,caseRow]=await Promise.all([
        allPages(()=>client.from('gi_thread_entries').select('*').eq(key,id).order('created_at').order('id')),
        incident?[]:allPages(()=>client.from('gi_task_events').select('action,note,created_at,id').eq('task_id',id).order('created_at').order('id')),
        incident?read(client.from('gi_cases').select('id,opened_at').eq('incident_id',id).maybeSingle()):null
      ]);
      if(!current())return;
      const parent=!incident&&row.case_id?await read(client.from('gi_cases').select('incident_id').eq('id',row.case_id).maybeSingle()):null;
      const related=caseRow?await allPages(()=>client.from('gi_tasks').select('id,title,created_at,status').eq('case_id',caseRow.id).order('id')):[];
      const docs=caseRow||!incident?await allPages(()=>client.from('gi_documents').select('id,title,phase,updated_at').eq(caseRow?'case_id':'task_id',caseRow?.id||id).order('id')):[];
      const originals=incident?await read(client.storage.from('gi-pilot-incident-photos').list(id,{limit:10})):[];
      if(!current())return;
      Object.assign(view,{row,caseRow,updates,events});
      const history=[{at:row.created_at,label:incident?'Užregistruotas įvykis':'Sukurta užduotis'}];
      if(incident&&row.status==='submitted')history.push({at:row.updated_at,label:'Pateikta patikrai'});
      if(caseRow)history.push({at:caseRow.opened_at,label:'Pradėta atvejo patikra'});
      for(const e of events)history.push({at:e.created_at,label:actions[e.action]||e.action,body:e.note});
      for(const t of related)history.push({at:t.created_at,label:'Sukurta susieta užduotis',url:threadLink('task',t.id,t.title)});
      for(const d of docs)history.push({at:d.updated_at,label:'Atnaujintas dokumentas',body:d.title+' · '+({draft:'Juodraštis',review:'Peržiūrimas',changes:'Grąžintas taisyti',ready:'Parengtas pasirašyti'}[d.phase]||d.phase)});
      for(const e of updates)history.push({at:e.created_at,label:(e.actor_name||'GI komandos narys')+' · '+contributionLabel(e),body:e.body,file:e.attachment,name:e.filename});
      history.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
      view.history=history;
      const contributors=updates.filter(e=>e.kind==='help');
      const participate=['volunteer','coordinator','admin'].includes(role())&&(!incident||row.status==='submitted');
      const canClaim=!incident&&row.status==='pool'&&!row.assigned_to;
      el('threadName').textContent=caseRow?'Atvejo kortelė':kindName[kind];
      el('threadTitle').textContent=incident?(categories[row.category]||'Įvykis'):row.title;
      const stateLabel=incident?({ongoing:'Vyksta',past:'Jau įvyko',needs_check:'Reikia patikrinti',unknown:'Būsena nežinoma'}[row.event_state]):statuses[row.status];
      content.innerHTML='<p class="tag">'+html(stateLabel)+'</p>'
        +(!incident&&row.created_at?'<p class="task-created small">Sukurta: '+html(when(row.created_at))+'</p>':'')
        +'<p class="task-description">'+html(incident?row.description:row.details)+'</p>'
        +(incident&&row.observed_at?'<p>Stebėjimo laikas · '+html(when(row.observed_at))+'</p>':'')
        +(incident&&row.latitude!==null?'<p>Koordinatės · '+html(row.latitude)+', '+html(row.longitude)+'</p>':'')
        +(incident&&row.extra_points?.length?'<ol>'+row.extra_points.map(p=>'<li>'+html(p[0])+', '+html(p[1])+'</li>').join('')+'</ol>':'')
        +(incident&&updates.some(e=>e.kind==='note'&&pointFromNote(e.body))?'<details><summary>Savanorių pridėtos koordinatės</summary><ul>'+updates.filter(e=>e.kind==='note'&&pointFromNote(e.body)).map(e=>'<li>'+html(pointFromNote(e.body))+' · '+html(e.actor_name||'GI komandos narys')+'</li>').join('')+'</ul></details>':'')
        +(!incident&&row.due_at?'<p>Terminas · '+html(when(row.due_at))+'</p>':'')
        +(!incident&&row.result_text?'<p>Rezultatas · '+html(row.result_text)+'</p>':'')
        +(parent?'<p>'+threadLink('incident',parent.incident_id,'Atverti susietą atvejį')+'</p>':'')
        +originals.map(f=>'<button type="button" class="outline" data-original="'+html(f.name)+'">Pradinė nuotrauka '+html(f.name)+'</button>').join(' ')
        +'<p class="small">'+(row.team_visible?'Kortelę gali atverti patvirtinti GI savanoriai.':'Nuorodą gali atverti turintys prieigą prie šio įrašo.')+'</p>'
        +'<div class="actions thread-primary">'
        +(participate&&!contributors.some(e=>e.actor_id===view.actor)?'<button type="button" data-do="help">Prisijungti padėti</button>':'')
        +(canClaim?'<button type="button" data-do="claim">Prisiimti užduotį</button>':'')+'</div>'
        +'<details class="thread-secondary"><summary>Kiti veiksmai</summary><div class="actions"><button type="button" class="outline" data-do="copy">Kopijuoti nuorodą</button>'
        +(navigator.share?'<button type="button" class="outline" data-do="share">Dalintis…</button>':'')
        +(isStaff()&&participate?'<button type="button" class="outline" data-do="visibility">'+(row.team_visible?'Riboti prieigą':'Atverti komandai')+'</button>':'')
        +'</div></details>'
        +(contributors.length?'<p><b>Padeda</b> · '+contributors.map(e=>html(e.actor_name)).join(', ')+'</p>':'')
        +(isStaff()&&incident&&row.status==='submitted'&&!caseRow?'<button type="button" data-do="case">Pradėti atvejo patikrą</button>':'')
        +(caseRow&&isStaff()?'<details><summary>Sukurti atvejo užduotį</summary><form data-new-task><label class="field">Pavadinimas<input name="title" required minlength="3" maxlength="140"></label><label class="field">Ką reikia atlikti?<textarea name="details" required minlength="5" maxlength="6000"></textarea></label><button>Sukurti užduotį</button></form></details>':'')
        +(participate?'<form data-update><label class="field">Papildyti situaciją<textarea name="body" maxlength="2000" placeholder="Kas pasikeitė arba kokios pagalbos reikia?"></textarea></label>'+(incident?'<details><summary>Pridėti koordinates</summary><label class="field">Platuma<input name="lat" type="number" inputmode="decimal" min="-90" max="90" step="any"></label><label class="field">Ilguma<input name="lon" type="number" inputmode="decimal" min="-180" max="180" step="any"></label></details>':'')+'<label class="field">Pridėti nuotrauką arba PDF (iki 5 MB)<input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label><button>Paskelbti papildymą</button></form>':'')
        +'<details class="thread-events"><summary><b>Istorija ('+history.length+')</b></summary>'
        +'<ol class="thread-history">'+historyItems(history.slice(0,5))+'</ol>'
        +(history.length>5?'<button type="button" class="outline" data-expand-history="1">Rodyti visą istoriją</button>':'')
        +'</details>';
    }catch(e){if(current()){el('threadTitle').textContent='Kortelės atverti nepavyko';el('threadStatus').textContent=e.message||'Patikrinkite ryšį.';}}
  }
  async function act(button,fn,success){
    if(!active||working)return;
    const view=active;working=true;const restore=busy(button,'Vykdoma…');
    el('threadStatus').textContent='';
    try{
      await fn(view);
      if(active!==view||user()?.id!==view.actor)return;
      await open(view.kind,view.id,false);
      if(active?.id===view.id){el('threadStatus').textContent=success;void refresh();}
    }catch(e){if(active===view)el('threadStatus').textContent=e.message||'Nepavyko. Bandykite dar kartą.';}
    finally{working=false;restore();}
  }
  content.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!active?.row||!b||working)return;
    const {kind,id,row}=active;
    if(b.dataset.expandHistory){
      const section=b.closest('.thread-events');
      const list=section?.querySelector('.thread-history');
      if(list)list.innerHTML=historyItems(active.history||[]);
      b.remove();
      return;
    }
    if(b.dataset.do==='copy'){
      if(await copyText(link(kind,id),'Užverti'))el('threadStatus').textContent='Nuoroda nukopijuota. Galite ją įklijuoti į komandos pokalbį.';
    }else if(b.dataset.do==='share'){
      try{await navigator.share({title:'GI komanda',url:link(kind,id)});}
      catch(e){if(e.name!=='AbortError')el('threadStatus').textContent='Pasirinkite „Kopijuoti nuorodą“ ir įklijuokite ją pokalbyje.';}
    }else if(b.dataset.do==='visibility'){
      const action=row.team_visible?'Riboti prieigą':'Atverti komandai';
      if(await ask(row.team_visible?'Bus taikomos įprastos įrašo prieigos teisės.':'Patvirtinti savanoriai galės matyti šios kortelės turinį, istoriją ir priedus.',{action}))
        await act(b,()=>read(client.rpc('gi_set_team_visibility',{p_kind:kind,p_id:id,p_visible:!row.team_visible})),'Matomumas pakeistas.');
    }else if(b.dataset.do==='help'){
      await act(b,async view=>{
        const res=await client.from('gi_thread_entries').insert({[kind+'_id']:id,kind:'help'});
        if(res.error&&res.error.code!=='23505')throw res.error;
      },'Prisijungėte padėti.');
    }else if(b.dataset.do==='case'){
      await act(b,()=>read(client.rpc('gi_open_case',{p_incident:id})),'Patikra pradėta.');
    }else if(b.dataset.do==='claim'){
      await act(b,()=>read(client.rpc('gi_task_action',{p_id:id,p_action:'claim',p_note:null})),'Užduotis priskirta jums.');
    }else if(b.dataset.file||b.dataset.original){
      const restore=busy(b,'Atveriama…');
      try{
        const store=b.dataset.original?client.storage.from('gi-pilot-incident-photos'):files();
        const path=b.dataset.original?id+'/'+b.dataset.original:b.dataset.file;
        const blob=await read(store.download(path));
        if(active?.id!==id)return;
        const url=URL.createObjectURL(blob);
        if(b.dataset.original||/\.(jpg|png|webp)$/i.test(path)){
          const img=new Image();img.alt=active.updates.find(u=>u.attachment===path)?.filename||'Pranešimo nuotrauka';
          img.style.cssText='display:block;max-width:100%;max-height:65vh;margin:.7em 0;object-fit:contain';
          img.onload=img.onerror=()=>URL.revokeObjectURL(url);img.src=url;b.after(img);b.hidden=true;
          return;
        }
        const a=document.createElement('a');a.href=url;a.download=b.dataset.original?'nuotrauka-'+b.dataset.original:b.textContent;
        if(b.dataset.file)a.download=active.updates.find(u=>u.attachment===path)?.filename||'Priedas';
        a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
      }catch(e){el('threadStatus').textContent=e.message;}finally{restore();}
    }
  });
  content.addEventListener('submit',e=>{
    e.preventDefault();const form=e.target,data=new FormData(form);
    if(!active?.row||working)return;
    if(form.hasAttribute('data-new-task')){
      return act(e.submitter,view=>read(client.rpc('gi_case_task',{p_case:view.caseRow.id,p_ref:view.request,p_title:data.get('title'),p_details:data.get('details')})),'Susieta užduotis sukurta.');
    }
    let body=String(data.get('body')||'').trim();const file=form.elements.file.files[0];
    const lat=data.get('lat'),lon=data.get('lon');
    if(active.kind==='incident'&&(lat||lon)){
      const line=coordinateLine(lat,lon);
      if(!line){el('threadStatus').textContent='Įveskite abi galiojančias koordinates.';return;}
      body=line+(body?'\n'+body:'');
    }
    if(body.length>2000){el('threadStatus').textContent='Papildymas negali viršyti 2000 simbolių.';return;}
    if(!body&&!file){el('threadStatus').textContent='Įrašykite komentarą arba pasirinkite priedą.';form.elements.body.focus();return;}
    if(file&&(!mime[file.type]||file.size>5242880)){el('threadStatus').textContent='Pasirinkite JPG, PNG, WebP arba PDF iki 5 MB.';return;}
    return act(e.submitter,async view=>{
      const row={id:view.request,[view.kind+'_id']:view.id,kind:'note',body};
      if(file){
        if(view.lastFile!==file){view.request=crypto.randomUUID();view.lastFile=file;view.uploaded=false;row.id=view.request;}
        const path=[view.actor,view.kind,view.id,row.id+'.'+mime[file.type]].join('/');
        if(!view.uploaded){
          const result=await files().upload(path,file,{contentType:file.type});
          if(result.error&&!['Duplicate','ResourceAlreadyExists'].includes(result.error.error)&&String(result.error.statusCode)!=='409')throw result.error;
          view.uploaded=true;
        }
        row.attachment=path;row.filename=file.name.slice(0,180);
      }
      const result=await client.from('gi_thread_entries').insert(row);
      if(result.error&&result.error.code!=='23505')throw result.error;
    },'Papildymas paskelbtas.');
  });
  document.addEventListener('click',async e=>{
    const a=e.target.closest('[data-thread]');if(!a||e.metaKey||e.ctrlKey||e.shiftKey)return;
    e.preventDefault();if(!working&&(!dialog.open||await mayLeave()))void open(a.dataset.thread,a.dataset.key);
  });
  // Scope polling to the open card and existing RLS; no background or whole-table subscriptions.
  async function checkActive(force=false){
    if(document.hidden||!dialog.open||!active?.row||working||checking)return;
    const view=active,key=view.kind==='incident'?'incident_id':'task_id';checking=true;
    try{
      const [row,latest]=await Promise.all([
        client.from(view.kind==='incident'?'gi_incidents':'gi_tasks').select('id,updated_at,team_visible,status').eq('id',view.id).maybeSingle(),
        client.from('gi_thread_entries').select('id').eq(key,view.id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()
      ]);
      if(active!==view||working||user()?.id!==view.actor)return;
      if((!row.error&&!row.data)||row.error?.code==='PGRST301'){await open(view.kind,view.id,false);return;}
      if(row.error||latest.error)return;
      const changed=row.data.updated_at!==view.row.updated_at||row.data.status!==view.row.status||row.data.team_visible!==view.row.team_visible||(latest.data?.id||null)!==(view.updates.at(-1)?.id||null);
      if(!force&&!changed)return;
      if(hasDraft()||document.activeElement?.closest('#threadContent form')){
        if(changed)el('threadStatus').textContent='Yra naujų papildymų. Jūsų nepaskelbtas įrašas išsaugotas ekrane.';
        return;
      }
      const expanded=[...content.querySelectorAll('details[open] > summary')].map(x=>x.textContent);
      const allHistory=!content.querySelector('[data-expand-history]');
      const scroll=dialog.scrollTop;
      await open(view.kind,view.id,false);
      if(active?.id!==view.id||active?.actor!==view.actor||!active?.row)return;
      if(allHistory&&active.history?.length>5){
        const list=content.querySelector('.thread-history');
        if(list)list.innerHTML=historyItems(active.history);
        content.querySelector('[data-expand-history]')?.remove();
      }
      for(const detail of content.querySelectorAll('details')){
        const summary=detail.querySelector(':scope > summary')?.textContent||'';
        if(expanded.includes(summary)||(detail.classList.contains('thread-events')&&expanded.some(x=>x.startsWith('Istorija ('))))detail.open=true;
      }
      dialog.scrollTop=scroll;
    }catch{}finally{checking=false;}
  }
  window.setInterval(()=>{void checkActive();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkActive();});
  return {clear,rememberRoute,afterLogin,link:threadLink,restore(){
    const r=route();if(r&&user()&&!active)void open(r.kind,r.id,false);
    if(active?.row&&!working)void checkActive(true);
  }};
};

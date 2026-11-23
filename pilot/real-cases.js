(() => {
  'use strict';
  // DELIBERATELY OFF until a reviewed restore test, MFA and GDPR sign-off.
  // This UX gate is NOT an authorization mechanism: Supabase RLS is mandatory.
  const WRITE_ENABLED = false;
  const API = 'https://mkhxokzuietqgjdpkcqq.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_VndeTSWHdWbtJXzNEBZDPg_KGX6eru1';
  const BUCKET = 'gi-real-evidence';
  const ALLOWED = new Set(['image/jpeg','image/png','image/webp','application/pdf']);
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const $ = id => document.getElementById(id);
  const db = window.supabase?.createClient(API,PUBLIC_KEY,{
    auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
  });
  let who=null,role=null,cases=[],members=[],selected=null,busy=false;
  const allowedStaff = () => ['admin','coordinator'].includes(role);
  const stamp = v => {try{return new Date(v).toLocaleString('lt-LT')}catch{return ''}};
  const status=(msg,error=false)=>{
    $('status').textContent=msg;
    $('status').className=error?'alert error':'muted';
  };
  const warn=() => !WRITE_ENABLED
    ?(status('Bylų modulis dar neaktyvuotas. Tikri duomenys šiame pilote draudžiami.',true),true)
    :false;
  async function loadSession(){
    if(!db){status('Nepavyko įkelti saugaus prisijungimo bibliotekos.',true);return;}
    const {data:{user},error}=await db.auth.getUser();
    if(error||!user){status('Prisijunkite per pagrindinę GI komandos darbo vietą.',true);return;}
    const result=await db.from('gi_profiles').select('id,role').eq('id',user.id).maybeSingle();
    if(result.error||!result.data||!['admin','coordinator','volunteer'].includes(result.data.role)){
      status('Prieiga prie šios dalies nesuteikta.',true);return;
    }
    who=user;role=result.data.role;
    $('secured').hidden=false;
    $('create').hidden=!(allowedStaff()&&WRITE_ENABLED);
    $('grantForm').hidden=!(allowedStaff()&&WRITE_ENABLED);
    $('uploadForm').hidden=!WRITE_ENABLED;
    $('accessSection').hidden=!allowedStaff();
    status(WRITE_ENABLED?'Prieigos teisės tikrinamos „Supabase“ serveryje.'
      :'Saugus bylų modulis parengtas testavimui. Įrašymas neįjungtas.');
    await refresh();
  }
  async function refresh(){
    if(!who)return;
    const {data,error}=await db.from('gi_real_cases')
      .select('id,external_ref,title,summary,sensitivity,status,created_at')
      .order('created_at',{ascending:false}).limit(100);
    if(error){status('Bylų schema dar neprijungta arba prieiga uždrausta. Patikrinkite sistemą.',true);return;}
    cases=data||[];
    const list=$('list');list.replaceChildren();
    if(!cases.length){const empty=document.createElement('p');empty.textContent='Jums prieinamų bylų nėra.';list.append(empty);}
    for(const item of cases){
      const b=document.createElement('button');
      b.className='case'+(selected===item.id?' active':'');
      b.type='button';
      const title=document.createElement('strong');title.textContent=item.external_ref+' · '+item.title;
      const meta=document.createElement('div');meta.className='muted';
      meta.textContent=(item.sensitivity==='restricted'?'Ribota':'Vidinė')+' · '+item.status+' · '+stamp(item.created_at);
      b.append(title,meta);b.addEventListener('click',()=>openCase(item.id));list.append(b);
    }
    if(selected && cases.some(c=>c.id===selected))await openCase(selected);
    else {$('detail').hidden=true;selected=null;}
  }
  async function openCase(id){
    const item=cases.find(x=>x.id===id);if(!item)return;
    selected=id;
    $('detail').hidden=false;
    $('caseTitle').textContent=item.external_ref+' · '+item.title;
    $('caseMeta').textContent=(item.sensitivity==='restricted'?'Ribota':'Vidinė')+' · '+item.status+' · '+stamp(item.created_at);
    $('caseSummary').textContent=item.summary;
    await Promise.all([loadEvents(id),loadEvidence(id),allowedStaff()?loadGrants(id):Promise.resolve()]);
  }
  async function loadEvents(caseId){
    const list=$('history');list.replaceChildren();
    const {data,error}=await db.from('gi_real_case_events')
      .select('event_type,recorded_at').eq('case_id',caseId)
      .order('recorded_at',{ascending:false}).limit(100);
    if(error)return;
    for(const event of (data||[])){
      const li=document.createElement('li');
      li.textContent=stamp(event.recorded_at)+' · '+event.event_type;
      list.append(li);
    }
  }
  async function loadGrants(caseId){
    const el=$('grants');el.replaceChildren();
    const {data,error}=await db.from('gi_real_case_access')
      .select('user_id,can_upload,revoked_at').eq('case_id',caseId);
    if(error){el.textContent='Prieigos peržiūra negalima.';return;}
    for(const x of (data||[])){
      const row=document.createElement('div');row.className='row';
      const text=document.createElement('span');
      text.textContent=(x.user_id===who.id?'Mano paskyra':x.user_id.slice(0,8))+
        ' · '+(x.revoked_at?'Atšaukta':x.can_upload?'Gali įkelti':'Tik peržiūra');
      row.append(text);
      if(WRITE_ENABLED&&!x.revoked_at){
        const b=document.createElement('button');b.className='secondary';b.type='button';b.textContent='Atšaukti';
        b.addEventListener('click',async()=>{
          if(!confirm('Atšaukti šio naudotojo prieigą?'))return;
          await mutate(()=>db.from('gi_real_case_access')
            .update({revoked_at:new Date().toISOString()}).eq('case_id',caseId).eq('user_id',x.user_id),
            'Prieiga atšaukta.');
          await loadGrants(caseId);
        });
        row.append(b);
      }
      el.append(row);
    }
    if(allowedStaff()&&WRITE_ENABLED){
      const result=await db.from('gi_profiles').select('id,display_name,role')
        .eq('role','volunteer').limit(100);
      members=result.data||[];
      const options=$('grantUser');options.replaceChildren();
      for(const member of members){
        const op=document.createElement('option');op.value=member.id;
        op.textContent=member.display_name||'Savanoris '+member.id.slice(0,8);
        options.append(op);
      }
    }
  }
  async function loadEvidence(caseId){
    const el=$('files');el.replaceChildren();
    // Storage RLS enforces case access; directory listing is never public.
    const store=db.storage.from(BUCKET);
    const {data:dirs,error}=await store.list(caseId,{limit:100});
    if(error){el.textContent='Priedų peržiūra neprieinama.';return;}
    let found=0;
    for(const folder of (dirs||[])){
      if(!folder.name||folder.id||!folder.name.match(/^[0-9a-f-]{36}$/i))continue;
      const {data:files,error:subError}=await store.list(caseId+'/'+folder.name,{limit:100});
      if(subError)continue;
      for(const file of (files||[])){
        if(!file.id)continue;
        found++;
        const path=caseId+'/'+folder.name+'/'+file.name;
        const row=document.createElement('div');row.className='file-item';
        const name=document.createElement('span');
        name.textContent=file.name+' · '+folder.name.slice(0,8);
        const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Atidaryti';
        button.addEventListener('click',async()=>{
          button.disabled=true;
          try{
            const {data,error}=await store.download(path);
            if(error||!data)throw Error('Denied');
            const url=URL.createObjectURL(data);
            // Open only a session-bound local blob, never mint shareable signed URLs.
            window.open(url,'_blank','noopener,noreferrer');
            setTimeout(()=>URL.revokeObjectURL(url),60000);
          }catch{status('Neįmanoma atidaryti priedo. Patikrinkite prieigą.',true);}
          finally{button.disabled=false;}
        });
        row.append(name,button);el.append(row);
      }
    }
    if(!found)el.textContent='Šioje byloje priedų nėra.';
  }
  async function mutate(action,ok){
    if(warn()||busy||navigator.onLine===false)return false;
    busy=true;
    try{
      const result=await action();
      if(result.error)throw result.error;
      status(ok);
      return true;
    }catch{
      status('Serveris nepatvirtino veiksmo. Patikrinkite prisijungimą ir savo teises.',true);
      return false;
    }finally{busy=false;}
  }
  $('refresh').addEventListener('click',refresh);
  $('closeDetail').addEventListener('click',()=>{selected=null;$('detail').hidden=true;});
  $('createForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!who||!allowedStaff())return;
    const f=new FormData(e.currentTarget);
    const record={external_ref:String(f.get('external_ref')||'').trim(),
      title:String(f.get('title')||'').trim(),summary:String(f.get('summary')||'').trim(),
      sensitivity:String(f.get('sensitivity')||'restricted'),opened_by:who.id};
    if(await mutate(()=>db.from('gi_real_cases').insert(record),'Byla įrašyta.')){
      e.currentTarget.reset();await refresh();
    }
  });
  $('grantForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!who||!selected||!allowedStaff())return;
    const grant={case_id:selected,user_id:$('grantUser').value,
      granted_by:who.id,can_upload:$('canUpload').checked};
    if(await mutate(()=>db.from('gi_real_case_access').insert(grant),'Prieiga priskirta.')){
      await loadGrants(selected);await loadEvents(selected);
    }
  });
  $('uploadForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!who||!selected)return;
    const files=Array.from($('evidenceFiles').files||[]);
    if(!files.length||files.length>10||files.some(f=>!ALLOWED.has(f.type)||f.size>MAX_FILE_BYTES)){
      status('Leidžiama iki 10 JPEG/PNG/WebP/PDF failų, kiekvienas iki 10 MB.',true);return;
    }
    if(warn()||busy)return;
    busy=true;
    try{
      for(const file of files){
        const suffix={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[file.type];
        const key=selected+'/'+who.id+'/'+crypto.randomUUID()+'.'+suffix;
        const {error}=await db.storage.from(BUCKET).upload(key,file,{contentType:file.type,upsert:false});
        if(error)throw error;
      }
      status('Priedai įkelti.');
      $('uploadForm').reset();await loadEvidence(selected);
    }catch{status('Ne visi priedai įkelti. Neįkelkite pakartotinai, kol nepatikrinote sąrašo.',true);}
    finally{busy=false;}
  });
  loadSession().catch(()=>status('Nepavyko patikrinti prieigos. Grįžkite į pagrindinę GI sistemą.',true));
})();
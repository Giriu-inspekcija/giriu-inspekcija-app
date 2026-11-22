(() => {
  'use strict';
  const URL = 'https://mkhxokzuietqgjdpkcqq.supabase.co';
  const KEY = 'sb_publishable_VndeTSWHdWbtJXzNEBZDPg_KGX6eru1';
  const $ = id => document.getElementById(id);
  const statusNames = {
    proposed:'Laukia patvirtinimo', pool:'Užduočių fonde', assigned:'Paskirta',
    accepted:'Priimta', in_progress:'Vykdoma', submitted:'Rezultatas pateiktas',
    returned:'Grąžinta', approved:'Patvirtinta'
  };
  const roleNames = {
    pending:'Laukia patvirtinimo',volunteer:'Savanoris',coordinator:'Koordinatorius',admin:'Administratorius'
  };
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const client = window.supabase && window.supabase.createClient(URL, KEY, {
    auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
  });
  let currentUser = null, profile = null, members = [], tasks = [], loading = false;

  function notice(msg, error = false) {
    const el = $('notice');
    if(!msg) {el.hidden = true; return;}
    el.textContent = msg;
    el.classList.toggle('error', !!error);
    el.hidden = false;
  }
  const staff = () => ['coordinator','admin'].includes(profile?.role);
  const admin = () => profile?.role === 'admin';
  const approved = () => ['volunteer','coordinator','admin'].includes(profile?.role);
  const personName = p => (p?.display_name || 'Naudotojas ' + String(p?.id || '').slice(0,8)).trim();
  function showLoggedOut() {
    currentUser = null; profile = null; tasks = []; members = [];
    $('authView').hidden = false;
    $('appView').hidden = true;
  }

  async function fetchProfile() {
    if(!currentUser) return;
    const {data,error} = await client.from('gi_profiles').select('id,display_name,role')
      .eq('id',currentUser.id).maybeSingle();
    if(error) throw error;
    profile = data || {id:currentUser.id,role:'pending',display_name:null};
  }
  async function refreshWorkspace() {
    if(!currentUser || loading) return;
    loading = true;
    try {
      await fetchProfile();
      $('greeting').textContent = profile.display_name ? 'Labas, ' + profile.display_name : 'Mano darbo vieta';
      $('roleName').textContent = roleNames[profile.role] || 'Laukia patvirtinimo';
      $('pendingView').hidden = approved();
      $('workspace').hidden = !approved();
      $('staffPanel').hidden = !staff();
      $('adminPanel').hidden = !admin();
      $('tasksHeading').textContent = staff() ? 'Organizacijos užduotys' : 'Mano užduotys';

      if(!approved()) return;
      const {data,error} = await client.from('gi_tasks')
        .select('id,title,details,status,priority,assigned_to,source_ref,result_text,feedback_text,created_at')
        .order('created_at',{ascending:false}).limit(150);
      if(error) throw error;
      tasks = data || [];
      if(staff()) {
        const {data:people,error:e2} = await client.from('gi_profiles')
          .select('id,display_name,role').order('display_name',{ascending:true}).limit(200);
        if(e2) throw e2;
        members = people || [];
      } else members = [];
      renderTasks();
      renderPendingMembers();
    } catch(error) {
      notice('Nepavyko atnaujinti: ' + (error?.message || String(error)), true);
    } finally {loading=false;}
  }

  function renderPendingMembers() {
    if(!admin()) return;
    const pending = members.filter(p => p.role === 'pending' && p.id !== currentUser.id);
    $('pendingMembers').innerHTML = pending.length
      ? pending.map(p=>'<div class="row card"><span>'+escapeHTML(personName(p))+'</span>'
        +'<button type="button" data-promote="'+escapeHTML(p.id)+'">Patvirtinti savanorį</button></div>').join('')
      : '<p class="small">Šiuo metu naujų prašymų nėra.</p>';
  }

  function buttonsFor(task) {
    const id = escapeHTML(task.id);
    if(staff()) {
      if(task.status === 'proposed') return '<div class="actions"><button type="button" data-step="publish" data-id="'+id+'">Patvirtinti į fondą</button></div>';
      if(['pool','assigned'].includes(task.status)) {
        const selectable = members.filter(m => ['volunteer','coordinator','admin'].includes(m.role));
        return '<div class="actions form-inline">'
          +'<select aria-label="Pasirinkti savanorį" data-person="'+id+'"><option value="">Pasirinkti savanorį</option>'
          +selectable.map(m=>'<option value="'+escapeHTML(m.id)+'"'+(task.assigned_to===m.id?' selected':'')+'>'+escapeHTML(personName(m))+'</option>').join('')
          +'</select><button type="button" data-assign="'+id+'">Paskirti</button></div>';
      }
      if(task.status === 'submitted') return '<div class="actions"><button type="button" data-step="approve" data-id="'+id+'">Patvirtinti rezultatą</button>'
        +'<button class="outline" type="button" data-step="return" data-id="'+id+'">Grąžinti taisyti</button></div>';
      return '';
    }
    if(task.status === 'assigned') return '<div class="actions"><button type="button" data-step="accept" data-id="'+id+'">Priimti užduotį</button></div>';
    if(['accepted','returned'].includes(task.status)) return '<div class="actions"><button type="button" data-step="start" data-id="'+id+'">Pradėti / tęsti</button></div>';
    if(task.status === 'in_progress') return '<div><form data-submit-result="'+id+'">'
      +'<label class="field">Darbo rezultatas<textarea name="result" required minlength="10" maxlength="6000" placeholder="Ką atlikai? (tik išgalvotas turinys)"></textarea></label>'
      +'<button type="submit">Pateikti rezultatą</button></form></div>';
    return '';
  }
  function timeEntry(task) {
    if(staff() && task.assigned_to !== currentUser.id) return '';
    if(!['accepted','in_progress','submitted','returned','approved'].includes(task.status)) return '';
    return '<hr><form class="form-inline" data-log-time="'+escapeHTML(task.id)+'">'
      +'<label class="field">Savanorystės minutės<input type="number" name="minutes" min="1" max="720" required placeholder="30"></label>'
      +'<label class="field">Aprašymas (demo)<input type="text" name="note" maxlength="1000" placeholder="Bandomoji veikla"></label>'
      +'<button type="submit">Įrašyti laiką</button></form>';
  }
  function renderTasks() {
    const list = $('taskList');
    if(!tasks.length){list.innerHTML='<div class="card"><p>Kol kas užduočių nėra.</p></div>';return;}
    const sorted = [...tasks].sort((a,b) => {
      const priority = {proposed:0,pool:1,submitted:2,assigned:3,accepted:4,in_progress:5,returned:6,approved:7};
      return (priority[a.status]??9) - (priority[b.status]??9);
    });
    list.innerHTML = sorted.map(t => {
      const owner = members.find(p=>p.id===t.assigned_to);
      return '<article class="task">'
        +'<div class="row"><span class="tag '+escapeHTML(t.status)+'">'+escapeHTML(statusNames[t.status]||t.status)+'</span>'
        +'<span class="small">'+escapeHTML(t.priority==='high'?'Svarbu':t.priority==='low'?'Maža svarba':'Įprasta')+'</span></div>'
        +'<h3>'+escapeHTML(t.title)+'</h3><p>'+escapeHTML(t.details)+'</p>'
        +(staff()?'<p class="small">Vykdytojas: '+escapeHTML(owner?personName(owner):'Nepaskirta')+'</p>':'')
        +(t.feedback_text?'<p class="alert">Koordinatoriaus pastaba: '+escapeHTML(t.feedback_text)+'</p>':'')
        +(t.result_text?'<p class="small"><b>Rezultatas:</b> '+escapeHTML(t.result_text)+'</p>':'')
        +buttonsFor(t)+timeEntry(t)
        +'</article>';
    }).join('');
  }
  async function run(call) {
    try {
      notice('');
      const result = await call();
      if(result?.error) throw result.error;
      await refreshWorkspace();
      notice('Veiksmas išsaugotas.');
    } catch(error) {
      notice(error?.message || 'Nepavyko atlikti veiksmo.', true);
    }
  }
  async function onSignIn() {
    if(!client){notice('Nepavyko įkelti prisijungimo bibliotekos. Patikrink interneto ryšį.',true);return;}
    const {data,error} = await client.auth.getUser();
    if(error || !data.user){showLoggedOut();return;}
    currentUser = data.user;
    $('authView').hidden = true; $('appView').hidden = false;
    await refreshWorkspace();
  }

  $('authForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!client) return notice('Prisijungimo biblioteka nepasiekiama.',true);
    const button=event.submitter;
    const mode=button?.value || 'login';
    const email=$('email').value.trim(), password=$('password').value, name=$('fullName').value.trim();
    if(mode==='signup' && !name) return notice('Registruojantis įrašyk savo vardą.',true);
    for(const b of $('authForm').querySelectorAll('button'))b.disabled=true;
    try{
      let result;
      if(mode==='signup') result=await client.auth.signUp({email,password,options:{data:{full_name:name},emailRedirectTo:location.href}});
      else result=await client.auth.signInWithPassword({email,password});
      if(result.error) throw result.error;
      if(result.data?.session){await onSignIn();}
      else notice('Registracija pateikta. Patvirtink el. pašto laišką, tada prisijunk. Vidines teises suteikia GI administratorius.');
    }catch(error){notice(error?.message || 'Prisijungimas nepavyko.',true)}
    finally{for(const b of $('authForm').querySelectorAll('button'))b.disabled=false;}
  });

  $('logout').addEventListener('click',async()=>{if(client) await client.auth.signOut();showLoggedOut();notice('Atsijungta.');});
  $('refresh').addEventListener('click',refreshWorkspace);
  $('pendingRefresh').addEventListener('click',refreshWorkspace);
  $('proposalForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(!staff()) return;
    const form=event.currentTarget, fd=new FormData(form);
    run(async()=>{
      const result=await client.rpc('gi_create_proposal',{
        p_title:String(fd.get('title')||''),p_details:String(fd.get('details')||''),
        p_priority:String(fd.get('priority')||'normal'),
        p_source_ref:'web-'+crypto.randomUUID()
      });
      if(!result.error) form.reset();
      return result;
    });
  });
  $('pendingMembers').addEventListener('click',event=>{
    const b=event.target.closest('[data-promote]');
    if(!b||!admin())return;
    if(!confirm('Patvirtinti šio naudotojo savanorio teises?'))return;
    run(()=>client.rpc('gi_set_user_role',{p_user:b.dataset.promote,p_role:'volunteer'}));
  });
  $('taskList').addEventListener('click',event=>{
    const b=event.target.closest('button');
    if(!b||loading)return;
    const id=b.dataset.id || b.dataset.assign;
    if(b.dataset.assign && staff()) {
      const choice=[...document.querySelectorAll('[data-person]')].find(e=>e.dataset.person===id)?.value;
      if(!choice)return notice('Pasirink savanorį.',true);
      return run(()=>client.rpc('gi_assign_task',{p_id:id,p_volunteer:choice}));
    }
    const action=b.dataset.step;
    if(!action)return;
    let note=null;
    if(action==='return'){
      note=prompt('Kodėl grąžini užduotį taisyti?');
      if(!note)return;
    }
    run(()=>client.rpc('gi_task_action',{p_id:id,p_action:action,p_note:note}));
  });
  $('taskList').addEventListener('submit',event=>{
    const form=event.target;
    if(form.dataset.submitResult){
      event.preventDefault();
      const note=form.querySelector('[name=result]').value.trim();
      return run(()=>client.rpc('gi_task_action',{p_id:form.dataset.submitResult,p_action:'submit',p_note:note}));
    }
    if(form.dataset.logTime){
      event.preventDefault();
      const fd=new FormData(form);
      return run(()=>client.rpc('gi_log_minutes',{
        p_id:form.dataset.logTime,p_minutes:Number(fd.get('minutes')),p_note:String(fd.get('note')||'')
      }));
    }
  });
  if(client){
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT')setTimeout(showLoggedOut,0);
      if(event==='SIGNED_IN'&&session?.user&&!currentUser)setTimeout(onSignIn,0);
    });
    onSignIn().catch(e=>notice('Prisijungimo klaida: '+e.message,true));
    setInterval(()=>{if(currentUser&&!document.hidden)refreshWorkspace()},30000);
  }else{
    notice('Nepavyko įkelti Supabase prisijungimo bibliotekos. Patikrink tinklą.',true);
  }
})();
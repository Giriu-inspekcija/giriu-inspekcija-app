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
  let currentUser = null, profile = null, members = [], tasks = [], feedback = [], loading = false;
  let authMode = 'signup', passwordRecovery = false;

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
    currentUser = null; profile = null; tasks = []; members = []; feedback = [];
    $('authView').hidden = false;
    $('appView').hidden = true;
    $('passwordResetView').hidden = true;
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
      const feedbackResult = await client.from('gi_feedback')
        .select('id,reporter_id,category,message,created_at').order('created_at',{ascending:false}).limit(60);
      if(feedbackResult.error) throw feedbackResult.error;
      feedback = feedbackResult.data || [];
      renderTasks();
      renderPendingMembers();
      renderFeedback();
    } catch(error) {
      notice('Nepavyko atnaujinti: ' + (error?.message || String(error)), true);
    } finally {loading=false;}
  }

  function renderPendingMembers() {
    if(!admin()) return;
    const others = members.filter(p => p.id !== currentUser.id);
    $('pendingMembers').innerHTML = others.length
      ? others.map(p=>'<div class="row card"><div><b>'+escapeHTML(personName(p))+'</b>'
        +'<p class="small">Dabartinė teisė: '+escapeHTML(roleNames[p.role]||p.role)+'</p></div>'
        +'<div class="form-inline"><select aria-label="Nauja naudotojo teisė" data-role-select="'+escapeHTML(p.id)+'">'
        +['pending','volunteer','coordinator'].map(role=>'<option value="'+role+'"'+(p.role===role?' selected':'')+'>'+escapeHTML(roleNames[role])+'</option>').join('')
        +'</select><button type="button" data-change-role="'+escapeHTML(p.id)+'">Išsaugoti</button></div></div>').join('')
      : '<p class="small">Kitų paskyrų dar nėra.</p>';
  }

  function renderFeedback() {
    $('feedbackTitle').textContent = staff() ? 'Visos bandymo pastabos' : 'Mano pastabos';
    $('feedbackList').innerHTML = feedback.length
      ? feedback.map(item => {
          const who = members.find(m=>m.id===item.reporter_id);
          return '<div class="card"><div class="row"><b>'+escapeHTML(item.category)+'</b>'
            +'<span class="small">'+escapeHTML(new Date(item.created_at).toLocaleDateString('lt-LT'))+'</span></div>'
            +'<p>'+escapeHTML(item.message)+'</p>'
            +(staff()?'<p class="small">Pateikė: '+escapeHTML(who?personName(who):'Testuotojas')+'</p>':'')
            +'</div>';
        }).join('')
      : '<p class="small">Pastabų dar nėra.</p>';
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

  function selectAuthMode(mode){
    if(!['signup','login'].includes(mode)) return;
    authMode = mode;
    const signup = mode === 'signup';
    $('authTitle').textContent = signup ? 'Registruotis' : 'Prisijungti';
    $('fullNameField').hidden = !signup;
    $('fullName').required = signup;
    $('password').autocomplete = signup ? 'new-password' : 'current-password';
    $('passwordLabel').textContent = signup ? 'Susikurkite programėlės slaptažodį' : 'Programėlės slaptažodis';
    $('authSubmit').textContent = signup ? 'Sukurti paskyrą' : 'Prisijungti';
    $('showSignup').className = signup ? '' : 'outline';
    $('showLogin').className = signup ? 'outline' : '';
    $('showSignup').setAttribute('aria-pressed',String(signup));
    $('showLogin').setAttribute('aria-pressed',String(!signup));
    $('forgotPassword').hidden = signup;
    $('password').value = '';
    notice('');
  }
  selectAuthMode('signup');
  $('showSignup').addEventListener('click',()=>selectAuthMode('signup'));
  $('showLogin').addEventListener('click',()=>selectAuthMode('login'));

  function authError(error){
    switch(error?.code) {
      case 'invalid_credentials':
        return 'Neteisingas el. paštas arba programėlės slaptažodis. Jei dar neturite paskyros, pasirinkite „Registruotis“.';
      case 'email_not_confirmed':
        return 'Pirmiausia patvirtinkite paskyrą el. paštu. Patikrinkite ir šlamšto aplanką.';
      case 'email_address_not_authorized':
        return 'Registracijos laiškų siuntimas šiam adresui dar neįjungtas. GI administratorius turi sukonfigūruoti SMTP arba Google prisijungimą.';
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return 'Viršyta el. laiškų siuntimo riba. Bandykite vėliau arba kreipkitės į koordinatorių.';
      case 'user_already_exists':
        return 'Paskyra jau sukurta. Rinkitės „Jau turiu paskyrą“ arba atkurkite slaptažodį.';
      default:
        return error?.message || 'Nepavyko atlikti veiksmo.';
    }
  }
  $('authForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!client) return notice('Prisijungimo biblioteka nepasiekiama.',true);
    const signup = authMode === 'signup';
    const email=$('email').value.trim(), password=$('password').value, name=$('fullName').value.trim();
    if(signup && !name) return notice('Registruojantis įrašykite vardą.',true);
    $('authSubmit').disabled=true;
    try{
      const result = signup
        ? await client.auth.signUp({
            email,password,
            options:{data:{full_name:name},emailRedirectTo:window.location.origin+window.location.pathname}
          })
        : await client.auth.signInWithPassword({email,password});
      if(result.error) throw result.error;
      if(result.data?.session) {
        await onSignIn();
        notice('Prisijungta. Naujos paskyros vidines teises suteikia GI administratorius.');
      } else if(signup) {
        notice('Registracijos užklausa priimta. Patikrinkite el. paštą ir patvirtinimo nuorodą. Jei laiško nėra, kreipkitės į GI – Supabase el. laiškų siuntimas gali būti dar nesukonfigūruotas.');
        selectAuthMode('login');
        // Preserve success message even after changing form mode.
        notice('Registracijos užklausa priimta. Jei gausite laišką, patvirtinkite paskyrą ir prisijunkite. Jei laiško nėra, kreipkitės į GI koordinatorių.');
      }else{
        notice('Prisijungimas nepatvirtintas. Patikrinkite el. paštą.',true);
      }
    }catch(error){notice(authError(error),true)}
    finally{$('authSubmit').disabled=false;}
  });

  $('forgotPassword').addEventListener('click',async()=>{
    if(!client)return notice('Prisijungimo biblioteka nepasiekiama.',true);
    const email = $('email').value.trim();
    if(!email || !$('email').checkValidity())return notice('Įrašykite teisingą el. pašto adresą.',true);
    const btn=$('forgotPassword');btn.disabled=true;
    try{
      const {error}=await client.auth.resetPasswordForEmail(email,{
        redirectTo:window.location.origin+window.location.pathname
      });
      if(error)throw error;
      notice('Jeigu paskyra egzistuoja ir el. laiškų siuntimas įjungtas, gausite slaptažodžio atkūrimo nuorodą.');
    }catch(error){notice(authError(error),true)}
    finally{btn.disabled=false;}
  });
  function displayPasswordReset(){
    passwordRecovery=true;
    $('authView').hidden=true;
    $('appView').hidden=true;
    $('passwordResetView').hidden=false;
    notice('Įveskite naują šios programėlės slaptažodį.');
  }
  $('passwordResetForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!passwordRecovery || !client)return;
    const newPassword=$('newPassword').value;
    if(newPassword.length<8)return notice('Slaptažodžiui reikia bent 8 simbolių.',true);
    try{
      const {error}=await client.auth.updateUser({password:newPassword});
      if(error)throw error;
      passwordRecovery=false;
      await client.auth.signOut();
      showLoggedOut();
      selectAuthMode('login');
      notice('Slaptažodis pakeistas. Dabar prisijunkite su naujuoju.',false);
    }catch(error){notice(authError(error),true)}
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
  $('feedbackForm').addEventListener('submit',event => {
    event.preventDefault();
    if(!currentUser || !approved()) return;
    const form=event.currentTarget, data=new FormData(form);
    run(async()=>{
      const result=await client.from('gi_feedback').insert({
        reporter_id:currentUser.id,
        category:String(data.get('category')||'pasiulymas'),
        message:String(data.get('message')||'').trim()
      });
      if(!result.error) form.reset();
      return result;
    });
  });
  // ChatGPT-generated proposals must be reviewed by a coordinator; never assign automatically.
  let reviewedBatch = null;
  function parseBatchInput() {
    const raw = JSON.parse($('batchJson').value);
    const arr = Array.isArray(raw) ? raw : raw?.tasks;
    if(!Array.isArray(arr) || arr.length < 1 || arr.length > 20) {
      throw Error('JSON turi turėti nuo 1 iki 20 užduočių.');
    }
    return arr.map((item,index)=>{
      if(!item || typeof item !== 'object' || Array.isArray(item)) throw Error('Netinkama užduotis Nr. '+(index+1));
      const title = String(item.title??'').trim();
      const details = String(item.details??'').trim();
      const priority = String(item.priority??'normal');
      const source_ref = String(item.source_ref??'').trim();
      if(title.length<3||title.length>140||details.length<5||details.length>6000
        ||!['low','normal','high'].includes(priority)||source_ref.length<3||source_ref.length>160) {
        throw Error('Neteisingi laukai užduotyje Nr. '+(index+1)+'. Reikia source_ref, title, details, priority.');
      }
      return {title,details,priority,source_ref};
    });
  }
  $('batchJson').addEventListener('input',()=>{
    reviewedBatch=null;$('batchImport').disabled=true;$('batchReview').textContent='';
  });
  $('batchPreview').addEventListener('click',()=>{
    if(!staff())return;
    try {
      const arr=parseBatchInput();
      const refs=arr.map(t=>t.source_ref);
      if(new Set(refs).size!==refs.length) throw Error('Sąraše yra pasikartojančių source_ref.');
      reviewedBatch=arr;
      $('batchReview').innerHTML='<b>Paruošta peržiūrai: '+arr.length+' užduočių.</b><ol>'
        +arr.map(t=>'<li><b>'+escapeHTML(t.title)+'</b> – '+escapeHTML(t.priority)
          +'<p class="small">'+escapeHTML(t.details.slice(0,200))+'</p></li>').join('')+'</ol>';
      $('batchImport').disabled=false;
    } catch(error) {
      reviewedBatch=null; $('batchImport').disabled=true; notice(error.message,true);
    }
  });
  $('batchImport').addEventListener('click',async()=>{
    if(!staff()||!reviewedBatch?.length)return;
    const copy=reviewedBatch;
    $('batchImport').disabled=true;
    let imported=0, failures=[];
    for(const t of copy){
      try {
        const result=await client.rpc('gi_create_proposal',{
          p_title:t.title,p_details:t.details,p_priority:t.priority,p_source_ref:t.source_ref
        });
        if(result.error) throw result.error;
        const taskId = result.data;
        if(!taskId) throw Error('Supabase negrąžino užduoties ID.');
        const existing = await client.from('gi_tasks').select('status').eq('id',taskId).single();
        if(existing.error) throw existing.error;
        if(existing.data.status === 'proposed') {
          const publish = await client.rpc('gi_task_action',{p_id:taskId,p_action:'publish',p_note:null});
          if(publish.error) throw publish.error;
        }
        imported++;
      } catch(err) {failures.push(t.source_ref+': '+(err?.message||String(err)));}
    }
    reviewedBatch=null;
    if(!failures.length){$('batchJson').value='';$('batchReview').textContent='';}
    else $('batchReview').textContent='Klaidos: '+failures.slice(0,5).join(' | ');
    await refreshWorkspace();
    notice('Patvirtintų siūlomų užduočių: '+imported+' iš '+copy.length
      +(failures.length?'. Dalis klaidų – žr. importo lauką.':'. Užduotys jau yra fonde.'),!!failures.length);
  });
  $('pendingMembers').addEventListener('click',event=>{
    const b=event.target.closest('[data-change-role]');
    if(!b||!admin())return;
    const id=b.dataset.changeRole;
    const role=[...document.querySelectorAll('[data-role-select]')].find(e=>e.dataset.roleSelect===id)?.value;
    if(!['pending','volunteer','coordinator'].includes(role))return;
    if(!confirm('Pakeisti naudotojo teises į „'+roleNames[role]+'“?'))return;
    run(()=>client.rpc('gi_set_user_role',{p_user:id,p_role:role}));
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
      if(event==='PASSWORD_RECOVERY')setTimeout(displayPasswordReset,0);
      if(event==='SIGNED_OUT'&&!passwordRecovery)setTimeout(showLoggedOut,0);
      if(event==='SIGNED_IN'&&session?.user&&!currentUser&&!passwordRecovery)setTimeout(onSignIn,0);
    });
    onSignIn().catch(e=>notice('Prisijungimo klaida: '+e.message,true));
    setInterval(()=>{if(currentUser&&!document.hidden)refreshWorkspace()},30000);
  }else{
    notice('Nepavyko įkelti Supabase prisijungimo bibliotekos. Patikrink tinklą.',true);
  }
})();
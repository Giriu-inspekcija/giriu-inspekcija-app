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
    pending:'Laukia patvirtinimo',candidate:'Kandidatas',volunteer:'Savanoris',coordinator:'Koordinatorius',admin:'Administratorius'
  };
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const client = window.supabase && window.supabase.createClient(URL, KEY, {
    auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
  });
  let currentUser = null, profile = null, members = [], tasks = [], feedback = [], loading = false;
  let authMode = 'signup', passwordRecovery = false;
  // Browser-side convenience only; Supabase rate limits must also remain enabled.
  const OTP_COOLDOWN_MS = 120000;
  const OTP_COOLDOWN_KEY = 'gi-pilot-confirmation-email-until';
  let inMemoryOtpCooldownUntil = 0;
  let otpRequestInFlight = false;
  function otpCooldownUntil() {
    try {
      return Math.max(inMemoryOtpCooldownUntil,
        Number(window.localStorage.getItem(OTP_COOLDOWN_KEY)) || 0);
    } catch {
      return inMemoryOtpCooldownUntil;
    }
  }
  function otpRemainingSeconds() {
    return Math.max(0,Math.ceil((otpCooldownUntil()-Date.now())/1000));
  }
  function setOtpCooldown() {
    const until=Date.now()+OTP_COOLDOWN_MS;
    inMemoryOtpCooldownUntil=until;
    try { window.localStorage.setItem(OTP_COOLDOWN_KEY,String(until)); } catch {}
    updateOtpButton();
    return until;
  }
  function clearOtpCooldownIfOwned(until) {
    if(inMemoryOtpCooldownUntil===until)inMemoryOtpCooldownUntil=0;
    try {
      if(Number(window.localStorage.getItem(OTP_COOLDOWN_KEY))===until)
        window.localStorage.removeItem(OTP_COOLDOWN_KEY);
    } catch {}
    updateOtpButton();
  }
  function updateOtpButton() {
    const status=$('signupSendStatus');
    status.hidden=authMode!=='signup';
    if(authMode!=='signup')return;
    const remaining=otpRemainingSeconds();
    $('authSubmit').disabled=otpRequestInFlight||remaining>0;
    $('authSubmit').textContent=otpRequestInFlight?'Siunčiama...'
      :remaining>0?'Siųsti dar kartą po '+remaining+' s':'Gauti patvirtinimo laišką';
    status.textContent=remaining>0
      ?'Pakartotinai siųsti galėsite po 2 minučių nuo paskutinio bandymo. Patikrinkite el. paštą ir šlamšto aplanką.'
      :'Vieną kartą paspauskite mygtuką ir patikrinkite savo el. paštą.';
  }

  const TASK_PAGE_SIZE = 50;
  let taskCursor = null, hasMoreTasks = false, taskFilter = 'all', memberSearchTerm = '';

  function notice(msg, error = false) {
    const el = $('notice');
    if(!msg) {el.hidden = true; return;}
    el.textContent = msg;
    el.classList.toggle('error', !!error);
    el.hidden = false;
  }
  const staff = () => ['coordinator','admin'].includes(profile?.role);
  const admin = () => profile?.role === 'admin';
  const approved = () => ['candidate','volunteer','coordinator','admin'].includes(profile?.role);
  const personName = p => (p?.display_name || 'Naudotojas ' + String(p?.id || '').slice(0,8)).trim();
  function showLoggedOut() {
    currentUser = null; profile = null; tasks = []; members = []; feedback = [];
    taskCursor = null; hasMoreTasks = false; taskFilter = 'all'; memberSearchTerm = '';
    $('authView').hidden = false;
    $('appView').hidden = true;
    $('passwordResetView').hidden = true;
    $('passwordSetupView').hidden = true;
  }

  async function fetchProfile() {
    if(!currentUser) return;
    const {data,error} = await client.from('gi_profiles').select('id,display_name,role,membership_intent,volunteer_rank,preferred_activity,region_label,can_prepare_documents')
      .eq('id',currentUser.id).maybeSingle();
    if(error) throw error;
    profile = data || {id:currentUser.id,role:'pending',display_name:null};
  }
  async function refreshWorkspace({appendTasks = false} = {}) {
    if(!currentUser || loading) return;
    loading = true;
    try {
      await fetchProfile();
      $('greeting').textContent = profile.display_name ? 'Labas, ' + profile.display_name : 'Mano darbo vieta';
      $('roleName').textContent = (roleNames[profile.role] || 'Laukia patvirtinimo') + (profile.volunteer_rank ? ' · '+({pradedantysis:'Pradedantysis',patyres:'Patyręs',vyriausias:'Vyriausias',regiono_vadas:'Regiono vadas'}[profile.volunteer_rank] || profile.volunteer_rank) : '');
      $('pendingView').hidden = approved();
      $('activateMaster').hidden = true;
      if(!approved()){
        const candidate=await client.rpc('gi_is_bootstrap_candidate');
        if(!candidate.error && candidate.data===true) $('activateMaster').hidden=false;
      }
      $('workspace').hidden = !approved();
      $('staffPanel').hidden = !staff();
      $('adminPanel').hidden = !staff();
      $('tasksHeading').textContent = staff() ? 'Organizacijos užduotys' : 'Mano užduotys';
      $('taskFilterPanel').hidden = !staff();
      $('memberSearchPanel').hidden = !staff();

      if(!approved()) return;
      const {data,error}=await client.rpc('gi_list_tasks_page',{
        p_before_created_at:appendTasks && taskCursor ? taskCursor.created_at : null,
        p_before_id:appendTasks && taskCursor ? taskCursor.id : null,
        p_limit:TASK_PAGE_SIZE+1,
        p_filter:staff()?taskFilter:'all'
      });
      if(error)throw error;
      const page=(data||[]).slice(0,TASK_PAGE_SIZE);
      hasMoreTasks=(data||[]).length>TASK_PAGE_SIZE;
      tasks=appendTasks?[...tasks,...page]:page;
      taskCursor=page.length?{
        created_at:page[page.length-1].created_at,
        id:page[page.length-1].id
      }:(appendTasks?taskCursor:null);
      $('taskLoadMore').hidden=!hasMoreTasks;
      $('taskPageInfo').textContent='Rodoma: '+tasks.length+' užduočių';
      if(staff()){
        let peopleQuery=client.from('gi_profiles')
          .select('id,display_name,role,created_at,membership_intent,preferred_activity,region_label,volunteer_rank,can_prepare_documents').order('created_at',{ascending:false}).limit(100);
        if(memberSearchTerm) peopleQuery=peopleQuery.ilike('display_name','%'+memberSearchTerm.replace(/[%_]/g,'')+'%');
        const {data:people,error:e2}=await peopleQuery;
        if(e2) throw e2;
        members=people||[];
      } else members=[];
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
    if(!staff())return;
    const others=members.filter(p=>p.id!==currentUser.id);
    const intentNames={new_candidate:'Naujas kandidatas',existing_volunteer:'Jau savanoriauja',unspecified:'Nenurodė'};
    const activityNames={field:'Išvykos ir fiksavimas',advocacy:'Advokacija',gis:'GIS',communications:'Komunikacija',other:'Kita'};
    const rankNames={pradedantysis:'Pradedantysis',patyres:'Patyręs',vyriausias:'Vyriausias',regiono_vadas:'Regiono vadas'};
    const info=p=>'<p class="small">Anketoje: '+escapeHTML(intentNames[p.membership_intent]||'Nenurodė')
      +' · '+escapeHTML(activityNames[p.preferred_activity]||'Kita')
      +(p.region_label?' · '+escapeHTML(p.region_label):'')+'</p>';
    const pending=others.filter(p=>p.role==='pending');
    const pendingRows=pending.map(p=>{
      const id=escapeHTML(p.id);
      const likelyExisting=p.membership_intent==='existing_volunteer';
      return '<div class="card"><b>'+escapeHTML(personName(p))+'</b>'+info(p)
        +'<p class="small">Anketoje pasirinktas statusas nėra įrodymas – prieš suteikdamas prieigą patikrink žmogų.</p>'
        +'<div class="actions">'
        +(likelyExisting
          ? '<button type="button" data-approve-volunteer="'+id+'">Patvirtinti savanorį</button>'
          : '<button type="button" data-approve-candidate="'+id+'">Priimti kandidatu</button>')
        +'<button type="button" class="outline" data-'+(likelyExisting?'approve-candidate':'approve-volunteer')+'="'+id+'">Kitas vaidmuo (po patikros)</button>'
        +'</div></div>';
    }).join('');
    const candidates=others.filter(p=>p.role==='candidate');
    const candidateRows=candidates.map(p=>'<div class="card"><b>'+escapeHTML(personName(p))+'</b>'
      +info(p)+'<p class="small">Kandidatas – tik specialiai pažymėtos užduotys</p>'
      +'<button type="button" data-promote-candidate="'+escapeHTML(p.id)+'">Patvirtinti kaip savanorį</button></div>').join('');
    const managed=admin()?others.filter(p=>['candidate','volunteer','coordinator'].includes(p.role)).map(p=>{
      const id=escapeHTML(p.id);
      return '<div class="card"><b>'+escapeHTML(personName(p))+'</b>'
        +'<p class="small">Dabartinis vaidmuo: '+escapeHTML(roleNames[p.role]||p.role)
        +(p.volunteer_rank?' · '+escapeHTML(rankNames[p.volunteer_rank]||p.volunteer_rank):'')+'</p>'
        +'<div class="form-inline"><select aria-label="Keisti vaidmenį" data-role-select="'+id+'">'
        +['pending','candidate','volunteer','coordinator'].map(role=>
          '<option value="'+role+'"'+(p.role===role?' selected':'')+'>'+escapeHTML(roleNames[role])+'</option>').join('')
        +'</select><button type="button" data-change-role="'+id+'">Išsaugoti vaidmenį</button></div>'
        +(['candidate','volunteer'].includes(p.role)?
         '<div class="form-inline"><select aria-label="Savanorio laipsnis" data-rank-select="'+id+'">'
          +Object.keys(rankNames).filter(k=>p.role!=='candidate'||k==='pradedantysis').map(rank=>
            '<option value="'+rank+'"'+(p.volunteer_rank===rank?' selected':'')+'>'+escapeHTML(rankNames[rank])+'</option>').join('')
          +'</select><button class="outline" type="button" data-rank-change="'+id+'">Patvirtinti laipsnį</button></div>'
          :'')
        +(p.role==='volunteer'
          ?'<div class="actions"><button type="button" class="outline" data-doc-permission="'+id+'">'
            +(p.can_prepare_documents?'Atšaukti raštų rengimo teisę':'Leisti rengti raštų projektus')+'</button></div>'
          :'')
        +'</div>';
    }).join(''):'';
    $('pendingMembers').innerHTML='<h3>Laukia patvirtinimo ('+pending.length+')</h3>'
      +(pendingRows||'<p class="small">Naujų registracijų nėra.</p>')
      +'<hr><h3>Kandidatai ('+candidates.length+')</h3>'
      +(candidateRows||'<p class="small">Patvirtintų kandidatų nėra.</p>')
      +(admin()?'<hr><h3>Vaidmenys ir papildomos teisės</h3>'
        +'<p class="small">Laipsnis savaime nesuteikia prieigos prie raštų ar jautrių bylų. Leidimas rengti raštus paruoštas, tačiau DI API dar neprijungta.</p>'
        +(managed||'<p class="small">Nėra valdomų paskyrų.</p>'):'');
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
    const id=escapeHTML(task.id);
    if(staff()) {
      const safeButton=(!task.assigned_to && ['proposed','pool'].includes(task.status))
        ? '<button type="button" class="outline" data-candidate-task="'+id+'">'
          +(task.candidate_safe?'Nebesiūlyti kandidatui':'Pažymėti saugia kandidato užduotimi')+'</button>' : '';
      if(task.status==='proposed') return '<div class="actions">'
        +'<button type="button" data-step="publish" data-id="'+id+'">Patvirtinti į fondą</button>'
        +safeButton+'</div>';
      if(['pool','assigned'].includes(task.status)) {
        const selectable=members.filter(m=>
          ['volunteer','coordinator','admin'].includes(m.role)
          || (m.role==='candidate' && task.candidate_safe));
        return '<div class="actions form-inline">'
          +'<select aria-label="Pasirinkti savanorį" data-person="'+id+'"><option value="">Pasirinkti savanorį</option>'
          +selectable.map(m=>'<option value="'+escapeHTML(m.id)+'"'+(task.assigned_to===m.id?' selected':'')+'>'
            +escapeHTML(personName(m))+' ('+escapeHTML(roleNames[m.role]||m.role)+')</option>').join('')
          +'</select><button type="button" data-assign="'+id+'">Paskirti</button>'
          +safeButton+'</div>';
      }
      if(task.status==='submitted') return '<div class="actions">'
        +'<button type="button" data-step="approve" data-id="'+id+'">Patvirtinti rezultatą</button>'
        +'<button class="outline" type="button" data-step="return" data-id="'+id+'">Grąžinti taisyti</button></div>';
      return '';
    }
    if(task.status==='assigned') return '<div class="actions"><button type="button" data-step="accept" data-id="'+id+'">Priimti užduotį</button></div>';
    if(['accepted','returned'].includes(task.status)) return '<div class="actions"><button type="button" data-step="start" data-id="'+id+'">Pradėti / tęsti</button></div>';
    if(task.status==='in_progress')return '<div><form data-submit-result="'+id+'">'
      +'<label class="field">Darbo rezultatas<textarea name="result" required minlength="10" maxlength="6000" placeholder="Ką užfiksavai? (kol kas tik išgalvotas turinys)"></textarea></label>'
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
    if(!tasks.length){list.innerHTML='<div class="card"><p>Pagal šį filtrą užduočių nėra.</p></div>';return;}
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
        +(staff()?'<p class="small">Vykdytojas: '+escapeHTML(owner?personName(owner):t.assigned_to?'Priskirtas savanoris (ieškok pagal vardą)':'Nepaskirta')+'</p>':'')
        +(t.candidate_safe?'<p class="small">Pažymėta kaip saugi kandidato užduotis (tik sintetinė)</p>':'')
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
    if(!client){notice('Nepavyko įkelti prisijungimo bibliotekos. Patikrinkite ryšį.',true);return;}
    const {data,error}=await client.auth.getUser();
    if(error || !data.user){showLoggedOut();return;}
    currentUser=data.user;
    // Email-link registrations have no password until verified; Google OAuth does not require one.
    const providers = data.user.app_metadata?.providers || [];
    const googleLogin = providers.includes('google');
    const check=await client.rpc('gi_password_needed');
    if(check.error){
      $('appView').hidden=true;
      $('authView').hidden=true;
      notice('Nepavyko patikrinti paskyros: '+check.error.message,true);
      return;
    }
    if(check.data===true && !googleLogin){
      $('authView').hidden=true;
      $('appView').hidden=true;
      $('passwordSetupView').hidden=false;
      $('passwordResetView').hidden=true;
      notice('El. paštas patvirtintas. Susikurkite slaptažodį ir tęskite.');
      return;
    }
    $('passwordSetupView').hidden=true;
    $('passwordResetView').hidden=true;
    $('authView').hidden=true;
    $('appView').hidden=false;
    await refreshWorkspace();
  }

  function selectAuthMode(mode){
    if(!['signup','login'].includes(mode))return;
    authMode=mode;
    const signup=mode==='signup';
    $('authTitle').textContent=signup?'Tapkite „Girių inspekcijos“ savanoriu':'Prisijungimas';
    $('fullNameField').hidden=!signup;
    $('fullName').required=signup;
    $('signupDetails').hidden=!signup;
    $('membershipIntent').required=signup;
    $('loginPasswordField').hidden=signup;
    $('password').required=!signup;
    $('authSubmit').textContent=signup?'Gauti patvirtinimo laišką':'Prisijungti';
    updateOtpButton();
    $('showSignup').className=signup?'':'outline';
    $('showLogin').className=signup?'outline':'';
    $('showSignup').setAttribute('aria-pressed',String(signup));
    $('showLogin').setAttribute('aria-pressed',String(!signup));
    $('forgotPassword').hidden=signup;
    $('password').value='';
    notice('');
  }
  selectAuthMode('signup');
  $('showSignup').addEventListener('click',()=>selectAuthMode('signup'));
  $('showLogin').addEventListener('click',()=>selectAuthMode('login'));
  window.setInterval(()=>{if(authMode==='signup')updateOtpButton();},1000);
  window.addEventListener('storage',event=>{
    if(event.key===OTP_COOLDOWN_KEY)updateOtpButton();
  });

  function authError(error){
    switch(error?.code) {
      case 'invalid_credentials':
        return 'Neteisingas el. paštas arba programėlės slaptažodis. Jei dar neturite paskyros, pasirinkite „Registruotis“.';
      case 'email_not_confirmed':
        return 'Pirmiausia patvirtinkite paskyrą el. paštu. Patikrinkite ir šlamšto aplanką.';
      case 'email_address_not_authorized':
        return 'Registracijos laiškų siuntimas šiam adresui dar neįjungtas. GI administratorius turi sukonfigūruoti SMTP arba Google prisijungimą.';
      case 'over_email_send_rate_limit':
        return 'Išnaudota bendra „Girių inspekcijos“ bandomojo pašto siuntimo riba (Supabase: 2 laiškai per valandą). Nespauskite pakartotinai. Jei jau patvirtinote el. paštą ir turite slaptažodį, rinkitės „Jau turiu paskyrą“. Masinei registracijai administratorius turi prijungti SMTP.';
      case 'over_request_rate_limit':
        return 'Per daug prisijungimo užklausų. Nebandykite siųsti pakartotinai iškart. Jei jau turite paskyrą, rinkitės „Jau turiu paskyrą“.';
      case 'user_already_exists':
        return 'Paskyra jau sukurta. Rinkitės „Jau turiu paskyrą“ arba atkurkite slaptažodį.';
      default:
        return error?.message || 'Nepavyko atlikti veiksmo.';
    }
  }
  $('authForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!client)return notice('Prisijungimas nepasiekiamas. Patikrinkite ryšį.',true);
    const signup=authMode==='signup';
    const email=$('email').value.trim().toLowerCase();
    const name=$('fullName').value.trim();
    const password=$('password').value;
    if(signup&&!name)return notice('Registruojantis įrašykite vardą.',true);
    const membershipIntent=$('membershipIntent').value;
    if(signup&&!['new_candidate','existing_volunteer'].includes(membershipIntent))
      return notice('Pasirinkite, ar esate naujas kandidatas, ar jau savanoriaujate.',true);
    if(signup&&(otpRequestInFlight||otpRemainingSeconds()>0)){
      updateOtpButton();
      return notice('Laiško užklausa jau pateikta arba dar galioja laukimo laikotarpis. Patikrinkite savo paštą.');
    }
    let reservedUntil=0;
    if(signup){
      otpRequestInFlight=true;
      reservedUntil=setOtpCooldown();
    } else $('authSubmit').disabled=true;
    try{
      if(signup){
        const {error}=await client.auth.signInWithOtp({
          email,options:{
            shouldCreateUser:true,
            emailRedirectTo:window.location.origin+window.location.pathname,
            data:{
              full_name:name,membership_intent:membershipIntent,
              preferred_activity:$('preferredActivity').value,
              region_label:$('regionLabel').value.trim()
            }
          }
        });
        if(error)throw error;
        notice('Registracijos laiško užklausa priimta. Patikrinkite paštą ir šlamšto aplanką. Pakartotinai siųsti galėsite po 2 minučių.');
      }else{
        const result=await client.auth.signInWithPassword({email,password});
        if(result.error)throw result.error;
        if(result.data?.session)await onSignIn();
        else notice('Prisijungimas nepatvirtintas. Patikrinkite el. paštą.',true);
      }
    }catch(error){
      if(signup&&!['over_email_send_rate_limit','over_request_rate_limit'].includes(error?.code)){
        clearOtpCooldownIfOwned(reservedUntil);
      }
      notice(authError(error),true);
    }finally{
      if(signup)otpRequestInFlight=false;
      if(authMode!=='signup'){
        $('authSubmit').disabled=false;
        $('authSubmit').textContent='Prisijungti';
      }else updateOtpButton();
    }
  });

  $('passwordSetupForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!currentUser||!client)return notice('Pirmiausia patvirtinkite savo el. paštą.',true);
    const p=$('initialPassword').value,p2=$('initialPasswordConfirm').value;
    if(p.length<8)return notice('Slaptažodis turi būti bent 8 simbolių.',true);
    if(p!==p2)return notice('Slaptažodžiai nesutampa.',true);
    const btn=$('passwordSetupForm').querySelector('button[type=submit]');
    btn.disabled=true;
    try{
      const {error}=await client.auth.updateUser({password:p});
      if(error)throw error;
      $('initialPassword').value='';
      $('initialPasswordConfirm').value='';
      await onSignIn();
      notice('Slaptažodis sukurtas. Dabar turite „Girių inspekcija“ paskyrą.');
    }catch(error){notice(authError(error),true)}
    finally{btn.disabled=false;}
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
  $('taskStatusFilter').addEventListener('change',event=>{
    if(!staff())return;
    taskFilter=String(event.target.value||'all');
    taskCursor=null;
    tasks=[];
    refreshWorkspace();
  });
  $('taskLoadMore').addEventListener('click',()=>{
    if(loading||!hasMoreTasks)return;
    refreshWorkspace({appendTasks:true});
  });
  $('memberSearchForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(!staff())return;
    memberSearchTerm=$('memberSearch').value.trim().slice(0,80);
    refreshWorkspace();
  });
  $('clearMemberSearch').addEventListener('click',()=>{
    if(!staff())return;
    memberSearchTerm='';
    $('memberSearch').value='';
    refreshWorkspace();
  });
  $('pendingRefresh').addEventListener('click',refreshWorkspace);
  $('activateMaster').addEventListener('click',async()=>{
    if(!client||!currentUser||profile?.role!=='pending')return;
    if(!confirm('Aktyvuoti šios patvirtintos paskyros pagrindinio administratoriaus teises?'))return;
    await run(()=>client.rpc('gi_claim_first_admin'));
  });

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
    const btn=event.target.closest('button');
    if(!btn || !staff())return;
    const id=btn.dataset.approveCandidate||btn.dataset.approveVolunteer
      ||btn.dataset.promoteCandidate||btn.dataset.changeRole
      ||btn.dataset.rankChange||btn.dataset.docPermission;
    if(!id || id===currentUser?.id)return;
    if(btn.dataset.approveCandidate) {
      if(!confirm('Patvirtinti šį žmogų kandidatu? Jis matys tik specialiai leistas užduotis.'))return;
      return run(()=>client.rpc('gi_approve_candidate',{p_user:id}));
    }
    if(btn.dataset.approveVolunteer){
      if(!confirm('Patvirtinti, kad šis žmogus yra GI savanoris?'))return;
      return run(()=>client.rpc('gi_approve_volunteer',{p_user:id}));
    }
    if(btn.dataset.promoteCandidate){
      if(!confirm('Po darbo peržiūros pakelti kandidatą į patvirtintą savanorį?'))return;
      return run(()=>client.rpc('gi_promote_candidate',{p_user:id}));
    }
    if(!admin())return;
    if(btn.dataset.changeRole){
      const role=[...document.querySelectorAll('[data-role-select]')].find(e=>e.dataset.roleSelect===id)?.value;
      if(!['pending','candidate','volunteer','coordinator'].includes(role))return;
      if(!confirm('Pakeisti šio nario vaidmenį į „'+roleNames[role]+'“?'))return;
      return run(()=>client.rpc('gi_set_user_role',{p_user:id,p_role:role}));
    }
    if(btn.dataset.rankChange){
      const rank=[...document.querySelectorAll('[data-rank-select]')].find(e=>e.dataset.rankSelect===id)?.value;
      if(!['pradedantysis','patyres','vyriausias','regiono_vadas'].includes(rank))return;
      if(!confirm('Patvirtinti savanorio patirties laipsnį?'))return;
      return run(()=>client.rpc('gi_set_volunteer_rank',{p_user:id,p_rank:rank}));
    }
    if(btn.dataset.docPermission){
      const person=members.find(m=>m.id===id);
      if(!person||person.role!=='volunteer')return;
      const allowed=!person.can_prepare_documents;
      if(!confirm((allowed?'Leisti':'Atšaukti')+' šio savanorio raštų projektų rengimo teisę? DI dar neprijungta.'))return;
      return run(()=>client.rpc('gi_set_document_permission',{p_user:id,p_allowed:allowed}));
    }
  });
  $('taskList').addEventListener('click',event=>{
    const b=event.target.closest('button');
    if(!b||loading)return;
    const id=b.dataset.id || b.dataset.assign || b.dataset.candidateTask;
    if(b.dataset.candidateTask && staff()){
      const task=tasks.find(t=>t.id===id);
      if(!task || task.assigned_to)return;
      const mark=!task.candidate_safe;
      if(mark && !confirm('Ar tai išgalvota, neskelbtina išvykos / mokymo užduotis, saugi kandidatui?'))return;
      return run(()=>client.rpc('gi_set_candidate_task',{
        p_id:id,p_safe:mark,p_kind:mark?'field_visit':(task.task_kind||'other')
      }));
    }
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
    // Avoid expensive all-table polling at larger volunteer counts.
    // Refresh on return to the app, plus a conservative 3-minute visible-session fallback.
    document.addEventListener('visibilitychange',()=>{
      if(currentUser && !document.hidden) refreshWorkspace();
    });
    window.addEventListener('focus',()=>{
      if(currentUser && !document.hidden) refreshWorkspace();
    });
    setInterval(()=>{if(currentUser&&!document.hidden)refreshWorkspace()},180000);
  }else{
    notice('Nepavyko įkelti Supabase prisijungimo bibliotekos. Patikrink tinklą.',true);
  }
})();
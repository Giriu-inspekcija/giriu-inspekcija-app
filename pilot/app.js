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
  let currentUser = null, profile = null, members = [], tasks = [], feedback = [], workLogs = [], incidents = [], memberEmails = {}, loading = false, activePanel = 'tasks';
  let authMode = 'login', passwordRecovery = false, mutationInFlight=false, toastTimer=null, timeOwnTasks=[];
  // Only a short-lived, non-authoritative UI reminder in this browser tab.
  // Verification and access are ALWAYS decided by Supabase Auth and database roles.
  const SIGNUP_WAITING_KEY = 'gi-pilot-signup-waiting-v1';
  function loadSignupWaiting() {
    try {
      const item=JSON.parse(window.sessionStorage.getItem(SIGNUP_WAITING_KEY)||'null');
      if(item && typeof item.email==='string' && Number.isFinite(item.at)
        && Date.now()-item.at>=0 && Date.now()-item.at<3600000) return item;
    } catch {}
    try {window.sessionStorage.removeItem(SIGNUP_WAITING_KEY)} catch {}
    return null;
  }
  let signupWaiting=loadSignupWaiting();
  function rememberSignupWaiting(email) {
    signupWaiting={email,at:Date.now()};
    try {window.sessionStorage.setItem(SIGNUP_WAITING_KEY,JSON.stringify(signupWaiting))} catch {}
    updateAccountSwitcher();
  }
  function clearSignupWaiting() {
    signupWaiting=null;
    try {window.sessionStorage.removeItem(SIGNUP_WAITING_KEY)} catch {}
    updateAccountSwitcher();
  }
  function showSignupWaiting() {
    const show=authMode==='signup' && !!signupWaiting;
    $('signupWaiting').hidden=!show;
    $('authForm').hidden=show;
    $('signupWaitingEmail').textContent=show?signupWaiting.email:'';
    if(show)$('signupWaitingStatus').textContent='Laiško užklausa priimta. Laukiama, kol atidarysite patvirtinimo nuorodą.';
    updateOtpButton();
    updateAccountSwitcher();
  }
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
    const remaining=otpRemainingSeconds();
    const status=$('signupSendStatus');
    status.hidden=authMode!=='signup'||!!signupWaiting;
    if(authMode!=='signup')return;
    $('authSubmit').disabled=otpRequestInFlight||remaining>0;
    $('authSubmit').textContent=otpRequestInFlight?'Siunčiama...'
      :remaining>0?'Siųsti dar kartą po '+remaining+' s':'Registruotis';
    const resend=$('resendSignupEmail');
    resend.disabled=otpRequestInFlight||remaining>0;
    resend.textContent=remaining>0?'Siųsti naują laišką po '+remaining+' s':'Siųsti naują laišką';
    status.textContent=remaining>0
      ?'Pakartotinai siųsti galėsite po 2 minučių nuo paskutinio bandymo.'
      :'Prieš siųsdami įsitikinkite, kad abu el. pašto adresai teisingi.';
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
  function toast(msg,error=false){
    const el=$('actionToast');
    if(toastTimer)clearTimeout(toastTimer);
    el.textContent=msg;
    el.classList.toggle('error',!!error);
    el.hidden=false;
    toastTimer=setTimeout(()=>{el.hidden=true;toastTimer=null;},6500);
  }
  const staff = () => ['coordinator','admin'].includes(profile?.role);
  const admin = () => profile?.role === 'admin';
  const approved = () => ['candidate','volunteer','coordinator','admin'].includes(profile?.role);
  const personName = p => (p?.display_name || 'Naudotojas ' + String(p?.id || '').slice(0,8)).trim();
  function updateAccountSwitcher() {
    const email=currentUser?.email || signupWaiting?.email || '';
    $('accountSwitchBar').hidden=!(email || passwordRecovery);
    $('accountSwitchLabel').textContent=email?'Paskyra: '+email:'Slaptažodžio keitimas';
    $('switchAccount').textContent=currentUser?'Atsijungti':'Kita paskyra';
  }
  function showLoggedOut() {
    currentUser = null; profile = null; tasks = []; members = []; feedback = []; workLogs=[];incidents=[];memberEmails={};
    activePanel='tasks';
    document.body.classList.remove('signed-in');
    timeOwnTasks=[];
    taskCursor = null; hasMoreTasks = false; taskFilter = 'all'; memberSearchTerm = '';
    $('authView').hidden = false;
    $('appView').hidden = true;
    $('passwordResetView').hidden = true;
    $('passwordSetupView').hidden = true;
    updateAccountSwitcher();
  }

  async function fetchProfile() {
    if(!currentUser) return;
    const {data,error} = await client.from('gi_profiles').select('id,display_name,role,registration_state,membership_intent,volunteer_rank,preferred_activity,region_label,can_prepare_documents')
      .eq('id',currentUser.id).maybeSingle();
    if(error) throw error;
    profile = data || {id:currentUser.id,role:'pending',display_name:null};
  }
  async function refreshWorkspace({appendTasks = false} = {}) {
    if(!currentUser || loading) return false;
    loading = true;
    try {
      await fetchProfile();
      $('greeting').textContent = profile.display_name ? 'Labas, ' + profile.display_name : 'Mano darbo vieta';
      $('roleName').textContent = (roleNames[profile.role] || 'Laukia patvirtinimo') + (profile.volunteer_rank ? ' · '+({pradedantysis:'Pradedantysis',patyres:'Patyręs',vyriausias:'Vyriausias',regiono_vadas:'Regiono vadas'}[profile.volunteer_rank] || profile.volunteer_rank) : '');
      $('pendingView').hidden = approved();
      const regState=profile.registration_state||'active';
      $('pendingHeading').textContent=regState==='rejected'?'Registracija atmesta':regState==='withdrawn'?'Registracija atšaukta':'Laukiama koordinatoriaus patvirtinimo';
      $('pendingDescription').textContent=regState==='rejected'
        ?'Koordinatorius atmetė bandomąją registraciją. Jei tai klaida, kreipkitės info@giriuinspekcija.lt.'
        :regState==='withdrawn'?'Jūsų registracija sustabdyta. Norėdami ją atkurti, susisiekite su GI koordinatoriumi.'
        :'Paskyra aktyvi. Po patikros koordinatorius suteiks tinkamą vaidmenį.';
      $('withdrawRegistration').hidden=regState!=='active';
      $('teamNav').hidden=!staff();
      openPanel(activePanel);
      $('activateMaster').hidden = true;
      if(!approved()){
        const candidate=await client.rpc('gi_is_bootstrap_candidate');
        if(!candidate.error && candidate.data===true && regState==='active') $('activateMaster').hidden=false;
      }
      $('workspace').hidden = !approved();
      $('staffPanel').hidden = !staff();
      $('adminPanel').hidden = !staff();
      $('tasksHeading').textContent = staff() ? 'Organizacijos užduotys' : 'Mano užduotys';
      $('taskFilterPanel').hidden = !staff();
      $('memberSearchPanel').hidden = !staff();

      if(!approved()) return true;
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
          .select('id,display_name,role,registration_state,created_at,membership_intent,preferred_activity,region_label,volunteer_rank,can_prepare_documents').order('created_at',{ascending:false}).limit(100);
        if(memberSearchTerm) peopleQuery=peopleQuery.ilike('display_name','%'+memberSearchTerm.replace(/[%_]/g,'')+'%');
        const {data:people,error:e2}=await peopleQuery;
        if(e2) throw e2;
        members=people||[];
        const ids=members.map(p=>p.id);
        const lookup=ids.length?await client.rpc('gi_member_emails',{p_ids:ids}):{data:[]};
        if(lookup.error)throw lookup.error;
        memberEmails=Object.fromEntries((lookup.data||[]).map(x=>[x.user_id,x]));
      } else {members=[];memberEmails={};}
      const feedbackResult = await client.from('gi_feedback')
        .select('id,reporter_id,category,message,created_at').order('created_at',{ascending:false}).limit(60);
      if(feedbackResult.error) throw feedbackResult.error;
      feedback = feedbackResult.data || [];
      const logFields='id,task_id,volunteer_id,minutes,note,activity_title,review_status,review_note,created_at';
      const ownLogs=await client.from('gi_work_logs').select(logFields)
        .eq('volunteer_id',currentUser.id).order('created_at',{ascending:false}).limit(70);
      if(ownLogs.error)throw ownLogs.error;
      let others=[];
      if(staff()){
        const pendingLogs=await client.from('gi_work_logs').select(logFields)
          .eq('review_status','submitted').neq('volunteer_id',currentUser.id)
          .order('created_at',{ascending:false}).limit(50);
        if(pendingLogs.error)throw pendingLogs.error;
        others=pendingLogs.data||[];
      }
      workLogs=[...(ownLogs.data||[]),...others];
      const ownTaskResult=await client.from('gi_tasks')
        .select('id,title,status,updated_at')
        .eq('assigned_to',currentUser.id)
        .order('updated_at',{ascending:false}).limit(25);
      if(ownTaskResult.error)throw ownTaskResult.error;
      timeOwnTasks=ownTaskResult.data||[];
      renderManualTimeTaskOptions();
      const incidentResult=await client.from('gi_incidents')
        .select('id,reporter_id,description,category,event_state,latitude,longitude,status,created_at')
        .order('created_at',{ascending:false}).limit(100);
      if(incidentResult.error)throw incidentResult.error;
      incidents=incidentResult.data||[];
      renderTasks();
      renderWorkLogs();
      renderIncidents();
      renderPendingMembers();
      renderFeedback();
      return true;
    } catch(error) {
      notice('Nepavyko atnaujinti: ' + (error?.message || String(error)), true);
      return false;
    } finally {loading=false;}
  }

  function openPanel(name) {
    if(!['tasks','time','incidents','team','feedback'].includes(name))name='tasks';
    if(name==='team'&&!staff())name='tasks';
    activePanel=name;
    for(const panel of ['tasks','time','incidents','team','feedback']){
      $(panel+'Section').hidden=panel!==name;
      const button=document.querySelector('[data-nav="'+panel+'"]');
      if(button) {
        if(panel===name)button.setAttribute('aria-current','page');
        else button.removeAttribute('aria-current');
      }
    }
  }
  $('workspaceNav').addEventListener('click',event=>{
    const button=event.target.closest('[data-nav]');
    if(!button)return;
    openPanel(button.dataset.nav);
  });
  const clockDuration=minutes=>Math.floor(minutes/60)+' val. '+(minutes%60)+' min.';
  function renderManualTimeTaskOptions(){
    const select=$('manualTimeTask'),old=select.value;
    select.innerHTML='<option value="">Kita savanorystės veikla (be užduoties)</option>'
      +timeOwnTasks.map(t=>'<option value="'+escapeHTML(t.id)+'">'
        +escapeHTML(t.title)+' ('+escapeHTML(statusNames[t.status]||t.status)+')</option>').join('');
    if(timeOwnTasks.some(t=>t.id===old))select.value=old;
    updateManualActivityMode();
  }
  function updateManualActivityMode(){
    const independent=!$('manualTimeTask').value;
    $('manualTimeActivityField').hidden=!independent;
    $('manualTimeActivity').required=independent;
    if(!independent)$('manualTimeActivity').value='';
  }
  $('manualTimeTask').addEventListener('change',updateManualActivityMode);
  function renderWorkLogs(){
    const mine=workLogs.filter(w=>w.volunteer_id===currentUser?.id);
    const waiting=mine.filter(w=>w.review_status==='submitted').reduce((sum,w)=>sum+w.minutes,0);
    const accepted=mine.filter(w=>w.review_status==='approved').reduce((sum,w)=>sum+w.minutes,0);
    $('myTimeSummary').textContent='Pateikta patvirtinti: '+clockDuration(waiting)+' · Patvirtinta: '+clockDuration(accepted);
    const entry=w=>{
      const task=timeOwnTasks.find(t=>t.id===w.task_id)||tasks.find(t=>t.id===w.task_id);
      const owner=members.find(p=>p.id===w.volunteer_id);
      const title=w.activity_title||task?.title||'Bandomasis darbas';
      return '<article class="card"><b>'+escapeHTML(title)+'</b>'
        +(w.volunteer_id!==currentUser?.id?'<p class="small">Vykdytojas: '+escapeHTML(owner?personName(owner):'Savanoris')+'</p>':'')
        +'<p>'+escapeHTML(clockDuration(w.minutes))+' · '
        +escapeHTML({submitted:'Pateikta',approved:'Patvirtinta',returned:'Grąžinta taisyti'}[w.review_status]||w.review_status)
        +'</p>'+(w.note?'<p class="small">'+escapeHTML(w.note)+'</p>':'')
        +(w.review_note?'<p class="small">Koordinatoriaus pastaba: '+escapeHTML(w.review_note)+'</p>':'')
        +(w.review_status==='returned'?'<p class="small">Patikslinkite pateikdami naują įrašą aukščiau.</p>':'')
        +(staff()&&w.review_status==='submitted'&&w.volunteer_id!==currentUser?.id
          ?'<div class="actions"><button type="button" data-time-approve="'+escapeHTML(w.id)+'">Patvirtinti laiką</button>'
           +'<button type="button" class="outline" data-time-return="'+escapeHTML(w.id)+'">Grąžinti taisyti</button></div>':'')
        +'</article>';
    };
    $('workLogsList').innerHTML=mine.length?mine.map(entry).join('')
      :'<p class="card">Jūsų pateiktų valandų dar nėra. Galite įrašyti ir atskirą savanorystės veiklą.</p>';
    const others=staff()?workLogs.filter(w=>w.volunteer_id!==currentUser?.id&&w.review_status==='submitted'):[];
    $('staffTimePanel').hidden=!staff();
    $('staffTimeLogs').innerHTML=others.length?others.map(entry).join('')
      :'<p class="small">Nėra kitų savanorių valandų, laukiančių patvirtinimo.</p>';
  }
  const incidentCategoryLabel={cutting:'Kirtimai',timber_truck:'Medienos vežimas',pollution:'Tarša',tree_damage:'Medžių pažeidimai',waste:'Atliekos',other:'Kita',unknown:'Nežinau'};
  function renderIncidents() {
    $('incidentsList').innerHTML=incidents.length?incidents.map(v=>{
      const owner=members.find(m=>m.id===v.reporter_id);
      return '<article class="card"><b>'+escapeHTML(incidentCategoryLabel[v.category]||v.category)+'</b>'
        +' · '+escapeHTML(v.status==='draft'?'Juodraštis':'Pateikta')
        +(staff()?'<p class="small">Pateikė: '+escapeHTML(owner?personName(owner):v.reporter_id===currentUser?.id?'Aš':'Naudotojas')+'</p>':'')
        +'<p>'+escapeHTML(v.description)+'</p>'
        +(v.latitude!==null&&v.longitude!==null?'<p class="small">Testinės koordinatės: '+escapeHTML(v.latitude)+'; '+escapeHTML(v.longitude)+'</p>':'')
        +(v.status==='draft'&&v.reporter_id===currentUser?.id
          ?'<button type="button" class="outline" data-edit-incident="'+escapeHTML(v.id)+'">Redaguoti juodraštį</button>':'')
        +'</article>';
    }).join(''):'<p class="card">Pranešimų dar nėra.</p>';
  }
  function renderPendingMembers() {
    if(!staff())return;
    const others=members.filter(p=>p.id!==currentUser?.id);
    const intentNames={new_candidate:'Naujas kandidatas',existing_volunteer:'Jau savanoriauja',unspecified:'Nenurodyta'};
    const activityNames={field:'Išvykos / fiksavimas',advocacy:'Advokacija',gis:'GIS',communications:'Komunikacija',other:'Kita'};
    const rankNames={pradedantysis:'Pradedantysis',patyres:'Patyręs',vyriausias:'Vyriausias',regiono_vadas:'Regiono vadas'};
    const person=p=>{
      const e=memberEmails[p.id];
      return '<b>'+escapeHTML(personName(p))+'</b>'
        +'<p class="small">'+escapeHTML(e?.email||'El. paštas nežinomas')
        +' · '+escapeHTML(e?.verified?'El. paštas patvirtintas':'El. paštas dar nepatvirtintas')+'</p>'
        +'<p class="small">Anketoje: '+escapeHTML(intentNames[p.membership_intent]||'Nenurodyta')
        +' · '+escapeHTML(activityNames[p.preferred_activity]||'Kita')
        +(p.region_label?' · '+escapeHTML(p.region_label):'')+'</p>';
    };
    const pending=others.filter(p=>p.role==='pending'&&(!p.registration_state||p.registration_state==='active'));
    const stopped=others.filter(p=>p.role==='pending'&&['withdrawn','rejected'].includes(p.registration_state));
    const candidates=others.filter(p=>p.role==='candidate');
    const pendingRows=pending.map(p=>{
      const id=escapeHTML(p.id),existing=p.membership_intent==='existing_volunteer';
      const verified=memberEmails[p.id]?.verified===true;
      return '<article class="card">'+person(p)
        +'<p class="small">'+(verified?'Statusas anketoje nėra patikrinimas. Patikrinkite žmogų.'
          :'El. paštas nepatvirtintas – savanorio teisių suteikti negalima.')+'</p>'
        +'<div class="actions">'
        +(verified?'<button type="button" data-approve-'+(existing?'volunteer':'candidate')+'="'+id+'">'
          +(existing?'Patvirtinti kaip savanorį':'Priimti kandidatu')+'</button>'
          +'<button type="button" class="outline" data-approve-'+(existing?'candidate':'volunteer')+'="'+id+'">'
          +(existing?'Priimti kandidatu':'Patvirtinti kaip savanorį')+'</button>':'')
        +'<button type="button" class="outline" data-reject-registration="'+id+'">Atmesti registraciją</button>'
        +'</div></article>';
    }).join('');
    const stoppedRows=stopped.map(p=>'<article class="card">'+person(p)
      +'<p class="small">Registracija: '+escapeHTML(p.registration_state==='withdrawn'?'atšaukta paties naudotojo':'atmesta koordinatoriaus')+'</p>'
      +'<button class="outline" type="button" data-restore-registration="'+escapeHTML(p.id)+'">Atkurti registracijos prašymą</button>'
      +(admin()&&memberEmails[p.id]?.verified===false
        ?'<button class="outline" type="button" data-purge-invalid="'+escapeHTML(p.id)+'">Išvalyti klaidingą adresą</button>':'')
      +'</article>').join('');
    const candidateRows=candidates.map(p=>'<article class="card">'+person(p)
      +'<p class="small">Kandidatas – tik specialiai pažymėtos demonstracinės užduotys.</p>'
      +'<button type="button" data-promote-candidate="'+escapeHTML(p.id)+'">Patvirtinti kaip savanorį</button>'
      +'</article>').join('');
    const managed=admin()?others.filter(p=>['candidate','volunteer','coordinator'].includes(p.role)).map(p=>{
      const id=escapeHTML(p.id);
      return '<article class="card">'+person(p)
        +'<p class="small">Dabartinis vaidmuo: '+escapeHTML(roleNames[p.role]||p.role)
        +(p.volunteer_rank?' · '+escapeHTML(rankNames[p.volunteer_rank]||p.volunteer_rank):'')+'</p>'
        +'<div class="form-inline"><select aria-label="Keisti vaidmenį" data-role-select="'+id+'">'
        +['pending','candidate','volunteer','coordinator'].map(role=>
          '<option value="'+role+'"'+(p.role===role?' selected':'')+'>'+escapeHTML(roleNames[role]||role)+'</option>').join('')
        +'</select><button type="button" data-change-role="'+id+'">Patvirtinti vaidmens pakeitimą</button></div>'
        +(['candidate','volunteer'].includes(p.role)?
          '<div class="form-inline"><select aria-label="Savanorio laipsnis" data-rank-select="'+id+'">'
          +Object.keys(rankNames).filter(k=>p.role!=='candidate'||k==='pradedantysis').map(rank=>
            '<option value="'+rank+'"'+(p.volunteer_rank===rank?' selected':'')+'>'+escapeHTML(rankNames[rank])+'</option>').join('')
          +'</select><button class="outline" type="button" data-rank-change="'+id+'">Patvirtinti laipsnį</button></div>'
          :'')
        +(p.role==='volunteer'
          ?'<div class="actions"><button type="button" class="outline" data-doc-permission="'+id+'">'
           +(p.can_prepare_documents?'Atšaukti raštų rengimo teisę':'Leisti rengti raštų projektus')+'</button></div>'
          :'')+'</article>';
    }).join(''):'';
    $('pendingMembers').innerHTML='<h3>Laukia peržiūros ('+pending.length+')</h3>'
      +(pendingRows||'<p class="small">Naujų registracijų nėra.</p>')
      +'<hr><h3>Atšauktos / atmestos ('+stopped.length+')</h3>'
      +(stoppedRows||'<p class="small">Nėra atšauktų registracijų.</p>')
      +'<hr><h3>Kandidatai ('+candidates.length+')</h3>'
      +(candidateRows||'<p class="small">Patvirtintų kandidatų nėra.</p>')
      +(admin()?'<hr><h3>Vaidmenys ir papildomos teisės</h3>'
        +'<p class="small">Laipsnis nesuteikia dokumentų prieigos. Registracijos atmetimas nėra „Supabase“ paskyros ištrynimas.</p>'
        +(managed||'<p class="small">Nėra valdomų narių.</p>'):'');
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

  function buttonsFor(task){
    const id=escapeHTML(task.id);
    let markup='';
    const staffEditable=staff()&&['proposed','pool','assigned'].includes(task.status);
    if(staffEditable){
      const safeButton=(!task.assigned_to&&['proposed','pool'].includes(task.status))
        ?'<button class="outline" type="button" data-candidate-task="'+id+'">'
          +(task.candidate_safe?'Nebesiūlyti kandidatui':'Leisti kandidatui (demo)')+'</button>':'';
      if(task.status==='proposed'){
        markup+='<div class="actions"><button type="button" data-step="publish" data-id="'+id+'">Paskelbti užduočių fonde</button>'
          +safeButton+'</div>';
      }else{
        if(task.status==='pool'&&!task.assigned_to){
          markup+='<div class="actions"><button type="button" data-step="claim" data-id="'+id+'">Prisiimti sau</button></div>';
        }
        const selectable=members.filter(m=>{
          const allowed=['volunteer','coordinator','admin'].includes(m.role)
            || (m.role==='candidate'&&task.candidate_safe);
          return allowed && memberEmails[m.id]?.verified;
        });
        markup+='<details><summary><b>Priskirti savanoriui</b></summary>'
          +'<div class="form-inline"><select aria-label="Pasirinkite vykdytoją" data-person="'+id+'">'
          +'<option value="">Pasirinkite savanorį</option>'
          +selectable.map(m=>'<option value="'+escapeHTML(m.id)+'"'+(task.assigned_to===m.id?' selected':'')+'>'
            +escapeHTML(personName(m))+' ('+escapeHTML(memberEmails[m.id]?.email||'')+')</option>').join('')
          +'</select><button type="button" data-assign="'+id+'">Priskirti</button></div>'
          +'</details>'
          +(task.status==='assigned'?'<div class="actions"><button class="outline" type="button" data-step="unassign" data-id="'+id+'">Atšaukti paskyrimą</button></div>':'')
          +safeButton;
      }
      markup+='<details><summary>Terminas (nebūtina)</summary>'
        +'<div class="form-inline"><label class="field">Užduoties terminas'
        +'<input aria-label="Užduoties terminas" type="datetime-local" data-due="'+id+'"'
        +(task.due_at?' value="'+escapeHTML(new Date(task.due_at).toLocaleString('sv-SE').replace(' ','T').slice(0,16))+'"':'')
        +'></label><button type="button" class="outline" data-set-due="'+id+'">Išsaugoti terminą</button></div></details>';
    }
    if(!staff() && !task.assigned_to && task.status==='pool' &&
      (profile?.role!=='candidate'||task.candidate_safe)){
      markup+='<div class="actions"><button type="button" data-step="claim" data-id="'+id+'">Pasiimti užduotį</button></div>';
    }
    if(task.assigned_to===currentUser?.id){
      if(task.status==='assigned')markup+='<div class="actions">'
        +'<button type="button" data-step="accept" data-id="'+id+'">Priimti užduotį</button>'
        +'<button type="button" class="outline" data-step="decline" data-id="'+id+'">Atsisakyti užduoties</button></div>';
      if(['accepted','returned'].includes(task.status))markup+='<div class="actions">'
        +'<button type="button" data-step="start" data-id="'+id+'">Pradėti / tęsti</button></div>';
      if(task.status==='in_progress')markup+='<form data-submit-result="'+id+'">'
        +'<label class="field">Atlikto darbo rezultatas<textarea name="result" required minlength="10" maxlength="6000" placeholder="Tik bandomasis aprašymas. Kas atlikta?"></textarea></label>'
        +'<button type="submit">Pateikti rezultatą</button></form>';
    }
    if(staff()&&task.status==='submitted'&&task.assigned_to!==currentUser?.id){
      markup+='<p class="small">Vienu veiksmu patvirtinsite rezultatą ir visus prie jo pateiktus laiko įrašus.</p>'
        +'<div class="actions"><button type="button" data-joint-approve="'+id+'">'
        +'Patvirtinti rezultatą ir laiką</button>'
        +'<button type="button" class="outline" data-step="return" data-id="'+id+'">Grąžinti taisyti</button></div>';
    }
    if(staff()&&task.status==='submitted'&&task.assigned_to===currentUser?.id)
      markup+='<p class="small">Jūsų rezultatą turi patvirtinti kitas koordinatorius.</p>';
    return markup;
  }
  function timeEntry(task){
    if(task.assigned_to!==currentUser?.id ||
       !['assigned','accepted','in_progress','submitted','returned','approved'].includes(task.status))return '';
    return '<div class="actions"><button type="button" class="outline" data-time-for-task="'+escapeHTML(task.id)+'">'
      +'Pridėti darbo laiką</button></div>';
  }
  function renderTasks(){
    const list=$('taskList');
    const mine=tasks.filter(t=>t.assigned_to===currentUser?.id);
    const pool=tasks.filter(t=>t.status==='pool'&&!t.assigned_to).length;
    const active=mine.filter(t=>['assigned','accepted','in_progress','returned'].includes(t.status)).length;
    const submitted=staff()?tasks.filter(t=>t.status==='submitted').length
      :mine.filter(t=>t.status==='submitted').length;
    $('taskSummary').innerHTML='<span><b>Mano aktyvios:</b> '+active+'</span>'
      +'<span><b>Užduočių fonde:</b> '+pool+'</span>'
      +'<span><b>Rezultatų peržiūra:</b> '+submitted+'</span>';
    if(!tasks.length){
      list.innerHTML='<div class="card"><p>Užduočių pagal pasirinktą filtrą nėra.</p></div>';return;
    }
    const order={proposed:0,pool:1,assigned:2,accepted:3,in_progress:4,returned:5,submitted:6,approved:7};
    const sorted=[...tasks].sort((a,b)=>(order[a.status]??9)-(order[b.status]??9));
    list.innerHTML=sorted.map(t=>{
      const owner=members.find(p=>p.id===t.assigned_to);
      let due='';
      if(t.due_at){
        const end=new Date(t.due_at),late=end.getTime()<Date.now()&&!['approved'].includes(t.status);
        due='<p class="small"><b>Terminas:</b> '+escapeHTML(end.toLocaleString('lt-LT',{dateStyle:'medium',timeStyle:'short'}))
          +(late?' · Terminas praėjęs':'')+'</p>';
      }
      return '<article class="task">'
        +'<div class="row"><span class="tag '+escapeHTML(t.status)+'">'
          +escapeHTML(statusNames[t.status]||t.status)+'</span>'
        +'<span class="small">'+escapeHTML(t.priority==='high'?'Svarbu':t.priority==='low'?'Maža svarba':'Įprasta')+'</span></div>'
        +'<h3>'+escapeHTML(t.title)+'</h3><p>'+escapeHTML(t.details)+'</p>'+due
        +(staff()?'<p class="small">Vykdytojas: '+escapeHTML(owner?personName(owner):t.assigned_to?'Priskirtas savanoris':'Nepaskirta')+'</p>':'')
        +(t.assigned_to===currentUser?.id?'<p class="small"><b>Paskirta man</b></p>':'')
        +(t.candidate_safe?'<p class="small">Kandidatui leista demonstracinė užduotis</p>':'')
        +(t.feedback_text?'<p class="alert">Koordinatoriaus pastaba: '+escapeHTML(t.feedback_text)+'</p>':'')
        +(t.result_text?'<p class="small"><b>Rezultatas:</b> '+escapeHTML(t.result_text)+'</p>':'')
        +buttonsFor(t)+timeEntry(t)+'</article>';
    }).join('');
  }
  // Prevent duplicate taps and show a persistent, local confirmation even when
  // the updated button disappears after a status transition.
  async function run(call,successMessage='Veiksmas išsaugotas.') {
    if(mutationInFlight)return false;
    mutationInFlight=true;
    const button=document.activeElement;
    const wasButton=button?.tagName==='BUTTON';
    if(wasButton)button.disabled=true;
    try {
      notice('');
      const result=await call();
      if(result?.error)throw result.error;
      const refreshed=await refreshWorkspace();
      if(!refreshed)throw Error('Pakeitimas išsaugotas, tačiau būsenos atnaujinti nepavyko. Spauskite „Atnaujinti“.');
      const msg=typeof successMessage==='function'?successMessage(result?.data):successMessage;
      notice(msg);
      toast(msg);
      return true;
    } catch(error) {
      const message='Nepavyko atlikti veiksmo: '+(error?.message||'Nežinoma klaida');
      notice(message,true);
      toast(message,true);
      return false;
    } finally {
      if(wasButton)button.disabled=false;
      mutationInFlight=false;
    }
  }
  async function onSignIn() {
    if(!client){notice('Nepavyko įkelti prisijungimo bibliotekos. Patikrinkite ryšį.',true);return;}
    const {data,error}=await client.auth.getUser();
    if(error || !data.user){showLoggedOut();return;}
    currentUser=data.user;
    updateAccountSwitcher();
    clearSignupWaiting();
    showSignupWaiting();
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
    document.body.classList.add('signed-in');
    await refreshWorkspace();
  }

  async function refreshGoogleProvider() {
    $('googleLoginPanel').hidden=true;
    $('googleSeparator').hidden=true;
    try {
      const res=await fetch(URL+'/auth/v1/settings',{headers:{apikey:KEY},cache:'no-store'});
      if(!res.ok)return;
      const settings=await res.json();
      const enabled=settings?.external?.google===true;
      $('googleLoginPanel').hidden=!enabled;
      $('googleSeparator').hidden=!enabled;
    }catch {}
  }
  $('googleLogin').addEventListener('click',async()=>{
    const button=$('googleLogin');
    button.disabled=true;
    try{
      if(!client)throw new Error('Prisijungimas nepasiekiamas.');
      const {error}=await client.auth.signInWithOAuth({
        provider:'google',options:{
          redirectTo:window.location.origin+window.location.pathname,
          queryParams:{prompt:'select_account'}
        }
      });
      if(error)throw error;
    }catch(error){
      notice('Google prisijungimo klaida: '+(error?.message||'bandykite dar kartą'),true);
      button.disabled=false;
    }
  });
  function selectAuthMode(mode){
    if(!['signup','login'].includes(mode))return;
    authMode=mode;
    const signup=mode==='signup';
    $('authTitle').textContent=signup?'Tapkite „Girių inspekcijos“ savanoriu':'Prisijungimas';
    $('fullNameField').hidden=!signup;
    $('fullName').required=signup;
    $('signupDetails').hidden=!signup;
    $('emailConfirmField').hidden=!signup;
    $('emailConfirm').required=signup;
    $('emailHelp').hidden=!signup;
    $('authIntro').textContent=signup
      ?'Užpildykite anketą, pasirinkite slaptažodį ir patvirtinkite el. paštą.'
      :'Prisijunkite su Google paskyra arba el. paštu ir slaptažodžiu.';
    $('membershipIntent').required=signup;
    $('loginPasswordField').hidden=signup;
    $('password').required=!signup;
    $('signupPasswordField').hidden=!signup;
    $('signupPasswordConfirmField').hidden=!signup;
    $('signupPassword').required=signup;
    $('signupPasswordConfirm').required=signup;
    $('authSubmit').hidden=false;
    $('authSubmit').disabled=false;
    $('authSubmit').textContent=signup?'Registruotis':'Prisijungti';
    updateOtpButton();
    $('showSignup').className=signup?'':'outline';
    $('showLogin').className=signup?'outline':'';
    $('showSignup').setAttribute('aria-pressed',String(signup));
    $('showLogin').setAttribute('aria-pressed',String(!signup));
    $('forgotPassword').hidden=signup;
    $('password').value='';
    showSignupWaiting();
    notice('');
  }
  selectAuthMode('login');
  refreshGoogleProvider();
  $('showSignup').addEventListener('click',()=>selectAuthMode('signup'));
  $('showLogin').addEventListener('click',()=>selectAuthMode('login'));
  window.setInterval(updateOtpButton,1000);
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
        return 'Pasiektas laiškų siuntimo limitas. Palaukite ir nebandykite pakartotinai kas kelias sekundes. Jei paskyra jau patvirtinta, rinkitės „Jau turiu paskyrą“.';
      case 'over_request_rate_limit':
        return 'Per daug prisijungimo užklausų. Nebandykite siųsti pakartotinai iškart. Jei jau turite paskyrą, rinkitės „Jau turiu paskyrą“.';
      case 'user_already_exists':
        return 'Paskyra jau sukurta. Rinkitės „Jau turiu paskyrą“ arba atkurkite slaptažodį.';
      default:
        return error?.message || 'Nepavyko atlikti veiksmo.';
    }
  }
  function likelyEmailTypo(email) {
    // Catch known typos before the email provider accepts a request.
    // Unknown real domains must stay allowed; existence is proven via confirmation link.
    // Do not silently correct addresses or reject unknown/legitimate mail domains.
    const at=email.lastIndexOf('@');
    if(at<1)return null;
    const domain=email.slice(at+1).toLowerCase();
    const fixes={
      'gmail.con':'gmail.com',
      'gmail.cmo':'gmail.com',
      'gmial.com':'gmail.com',
      'outlook.con':'outlook.com',
      'hotmail.con':'hotmail.com',
      'yahoo.con':'yahoo.com'
    };
    return fixes[domain]?email.slice(0,at+1)+fixes[domain]:null;
  }

  function updateEmailHint() {
    if(authMode!=='signup')return;
    const email=$('email').value.trim().toLowerCase();
    const confirmEmail=$('emailConfirm').value.trim().toLowerCase();
    const typo=likelyEmailTypo(email);
    let msg='Abu el. pašto adresai turi sutapti.';
    if(typo)msg='Gal turėjote omenyje „'+typo+'“? Pataisykite prieš registruodamiesi.';
    else if(email && !$('email').checkValidity()) msg='Įveskite taisyklingą el. pašto adresą.';
    else if(confirmEmail && confirmEmail!==email)msg='Adresai nesutampa – patikrinkite abi eilutes.';
    else if(email && confirmEmail && email===confirmEmail)msg='Adresai sutampa. Laišką gausite tik jei pašto dėžutė egzistuoja.';
    $('emailHelp').textContent=msg;
    $('emailHelp').classList.toggle('invalid',!!typo||!!(confirmEmail&&confirmEmail!==email));
  }
  $('email').addEventListener('input',updateEmailHint);
  $('emailConfirm').addEventListener('input',updateEmailHint);

  async function checkSignedInAfterEmail() {
    if(!client)return notice('Prisijungimas nepasiekiamas. Patikrinkite ryšį.',true);
    const button=$('checkSignupStatus');
    button.disabled=true;
    try {
      const {data,error}=await client.auth.getSession();
      if(error)throw error;
      if(data?.session?.user) {
        await onSignIn();
        return;
      }
      $('signupWaitingStatus').textContent=
        'Šioje naršyklėje prisijungimo dar nėra. Atidarykite laiško nuorodą. Jeigu ją atidarėte kitame telefone ar naršyklėje, ten užbaikite slaptažodžio kūrimą, o čia prisijunkite su slaptažodžiu.';
    } catch(error) {
      $('signupWaitingStatus').textContent='Nepavyko patikrinti šio įrenginio prisijungimo: '+(error?.message||'klaida')+'. Bandykite dar kartą.';
    } finally {button.disabled=false;}
  }
  $('checkSignupStatus').addEventListener('click',checkSignedInAfterEmail);
  $('resendSignupEmail').addEventListener('click',async()=>{
    if(otpRequestInFlight||otpRemainingSeconds()>0)return;
    if(!client||!signupWaiting?.email)return;
    otpRequestInFlight=true;
    const until=setOtpCooldown();
    try{
      const {error}=await client.auth.resend({
        type:'signup',email:signupWaiting.email,
        options:{emailRedirectTo:window.location.origin+window.location.pathname}
      });
      if(error)throw error;
      $('signupWaitingStatus').textContent='Patvirtinimo laiškas užsakytas dar kartą. Patikrinkite el. paštą.';
      notice('');
    }catch(error){
      if(!['over_email_send_rate_limit','over_request_rate_limit'].includes(error?.code))
        clearOtpCooldownIfOwned(until);
      notice(authError(error),true);
    }finally{otpRequestInFlight=false;updateOtpButton();}
  });
  $('editSignupEmail').addEventListener('click',()=>{
    const email=signupWaiting?.email||'';
    clearSignupWaiting(); showSignupWaiting();
    $('email').value=email; $('emailConfirm').value='';
    updateEmailHint(); $('email').focus();
    notice('Pataisykite el. paštą ir pakartokite jį antroje eilutėje. Nauja užklausa bus leidžiama pasibaigus siuntimo pertraukai.');
  });
  $('stopSignup').addEventListener('click',()=>{
    clearSignupWaiting(); $('authForm').reset(); showSignupWaiting(); updateEmailHint();
    notice('Pildymą sustabdėte. Jau išsiųsto laiško tai neatšaukia; paskyra gali likti sistemoje. Jei norite pašalinti paskyrą, rašykite info@giriuinspekcija.lt.');
  });

  $('authForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!client)return notice('Prisijungimas nepasiekiamas. Patikrinkite ryšį.',true);
    const signup=authMode==='signup';
    const email=$('email').value.trim().toLowerCase();
    const name=$('fullName').value.trim();
    const password=$('password').value;
    const signupPassword=$('signupPassword').value;
    const signupPasswordConfirm=$('signupPasswordConfirm').value;
    const suggestedEmail=likelyEmailTypo(email);
    if(signup&&suggestedEmail){
      $('email').focus();
      updateEmailHint();
      return notice('Pataisykite el. paštą į „'+suggestedEmail+'“ (jei tai jūsų adresas). Laiškas dar nesiųstas.',true);
    }
    if(signup&&email!==$('emailConfirm').value.trim().toLowerCase()){
      $('emailConfirm').focus();
      updateEmailHint();
      return notice('El. pašto adresai nesutampa. Pakartokite teisingą adresą.',true);
    }
    if(signup&&!name)return notice('Registruojantis įrašykite vardą.',true);
    if(signup&&signupPassword.length<8)return notice('Slaptažodžiui reikia bent 8 simbolių.',true);
    if(signup&&signupPassword!==signupPasswordConfirm)return notice('Slaptažodžiai nesutampa.',true);
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
        const {data,error}=await client.auth.signUp({
          email,password:signupPassword,
          options:{
            emailRedirectTo:window.location.origin+window.location.pathname,
            data:{
              full_name:name,membership_intent:membershipIntent,
              preferred_activity:$('preferredActivity').value,
              region_label:$('regionLabel').value.trim()
            }
          }
        });
        if(error)throw error;
        $('signupPassword').value='';
        $('signupPasswordConfirm').value='';
        if(data?.session)await onSignIn();
        else {rememberSignupWaiting(email);showSignupWaiting();notice('');}
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
    updateAccountSwitcher();
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
    if(newPassword!==$('newPasswordConfirm').value)return notice('Slaptažodžiai nesutampa.',true);
    try{
      const {error}=await client.auth.updateUser({password:newPassword});
      if(error)throw error;
      $('passwordResetForm').reset();
      passwordRecovery=false;
      await client.auth.signOut({scope:'local'});
      showLoggedOut();
      selectAuthMode('login');
      notice('Slaptažodis pakeistas. Dabar prisijunkite su naujuoju.',false);
    }catch(error){notice(authError(error),true)}
  });

  // Switch only this browser's session; leave other devices signed in.
  let switchingAccount=false;
  async function switchAccount() {
    if(switchingAccount)return;
    const button=$('switchAccount');
    switchingAccount=true;
    button.disabled=true;
    $('logout').disabled=true;
    try {
      if(!client)throw new Error('Prisijungimo biblioteka nepasiekiama. Patikrinkite ryšį.');
      const {data,error}=await client.auth.getSession();
      if(error)throw error;
      if(data?.session){
        const result=await client.auth.signOut({scope:'local'});
        if(result.error)throw result.error;
      }
      passwordRecovery=false;
      clearSignupWaiting();
      $('authForm').reset();
      $('passwordSetupForm').reset();
      $('passwordResetForm').reset();
      showLoggedOut();
      selectAuthMode('login');
      $('email').value='';
      notice('Galite prisijungti kita paskyra.');
      $('email').focus();
    }catch(error){
      notice('Nepavyko pakeisti paskyros: '+(error?.message||'klaida'),true);
    }finally{
      switchingAccount=false;
      button.disabled=false;
      $('logout').disabled=false;
    }
  }
  $('switchAccount').addEventListener('click',switchAccount);
  $('logout').addEventListener('click',switchAccount);
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
  $('withdrawRegistration').addEventListener('click',async()=>{
    if(!currentUser||profile?.role!=='pending'||profile?.registration_state!=='active')return;
    if(!confirm('Atšaukti registracijos prašymą? Prieiga nebus suteikta. Paskyros duomenys nebus automatiškai ištrinti.'))return;
    await run(()=>client.rpc('gi_review_registration',{p_user:currentUser.id,p_action:'withdraw'}));
  });
  $('pendingRefresh').addEventListener('click',async()=>{
    await refreshWorkspace();
    if(profile?.role==='pending')notice('Būsena nepasikeitė: laukiate koordinatoriaus patvirtinimo.');
    else if(profile)notice('Jūsų būsena: '+(roleNames[profile.role]||profile.role)+'.');
  });
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
    if(!btn || !staff() || mutationInFlight)return;
    const id=btn.dataset.approveCandidate||btn.dataset.approveVolunteer
      ||btn.dataset.promoteCandidate||btn.dataset.changeRole
      ||btn.dataset.rankChange||btn.dataset.docPermission
      ||btn.dataset.rejectRegistration||btn.dataset.restoreRegistration||btn.dataset.purgeInvalid;
    if(!id || id===currentUser?.id)return;
    const person=members.find(p=>p.id===id);
    const email=memberEmails[id]?.email||'';
    if(btn.dataset.purgeInvalid){
      if(!admin()||person?.role!=='pending'||memberEmails[id]?.verified!==false
        ||!['rejected','withdrawn'].includes(person.registration_state))return;
      const typed=prompt('Negrįžtamai pašalinti nepatvirtintą registraciją. Patvirtinkite įvesdami tikslų el. paštą: '+email);
      if(typed===null)return;
      if(typed.trim().toLowerCase()!==email.toLowerCase()){
        toast('Adresas nesutampa. Nieko nepašalinta.',true);return;
      }
      return run(()=>client.rpc('gi_purge_invalid_signup',{p_user:id,p_expected_email:email}),
        'Klaidinga nepatvirtinta registracija išvalyta.');
    }
    if(btn.dataset.rejectRegistration){
      if(!person||person.role!=='pending')return;
      if(!confirm('Atmesti '+personName(person)+' registracijos prašymą? Tai neatlieka fizinio paskyros ištrynimo.'))return;
      return run(()=>client.rpc('gi_review_registration',{p_user:id,p_action:'reject'}),
        'Registracija atmesta: '+email);
    }
    if(btn.dataset.restoreRegistration){
      if(!person||person.role!=='pending')return;
      if(!confirm('Atkurti '+personName(person)+' registracijos prašymą peržiūrai?'))return;
      return run(()=>client.rpc('gi_review_registration',{p_user:id,p_action:'restore'}),
        'Registracija grąžinta peržiūrai: '+email);
    }
    if(btn.dataset.approveCandidate) {
      if(!confirm('Patvirtinti šį žmogų kandidatu? Jis matys tik specialiai leistas užduotis.'))return;
      return run(()=>client.rpc('gi_approve_candidate',{p_user:id}),
        'Kandidatas priimtas: '+email);
    }
    if(btn.dataset.approveVolunteer){
      if(!confirm('Patvirtinti, kad šis žmogus yra GI savanoris?'))return;
      return run(()=>client.rpc('gi_approve_volunteer',{p_user:id}),
        'Savanoris patvirtintas: '+email);
    }
    if(btn.dataset.promoteCandidate){
      if(!confirm('Po darbo peržiūros pakelti kandidatą į patvirtintą savanorį?'))return;
      return run(()=>client.rpc('gi_promote_candidate',{p_user:id}),
        'Kandidatas patvirtintas savanoriu: '+email);
    }
    if(!admin())return;
    if(btn.dataset.changeRole){
      const role=[...document.querySelectorAll('[data-role-select]')].find(e=>e.dataset.roleSelect===id)?.value;
      if(!['pending','candidate','volunteer','coordinator'].includes(role))return;
      if(!confirm('Pakeisti šio nario vaidmenį į „'+roleNames[role]+'“?'))return;
      if(role===person?.role)return toast('Jokių pakeitimų: jau pasirinktas vaidmuo „'+roleNames[role]+'“.');
      return run(()=>client.rpc('gi_set_user_role',{p_user:id,p_role:role}),
        'Vaidmuo pakeistas į „'+roleNames[role]+'“: '+email);
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
    if(!b||loading||mutationInFlight)return;
    const id=b.dataset.id || b.dataset.assign || b.dataset.candidateTask
      || b.dataset.jointApprove || b.dataset.timeForTask;
    if(b.dataset.timeForTask){
      const task=tasks.find(t=>t.id===id);
      if(task && task.assigned_to===currentUser?.id){
        const select=$('manualTimeTask');
        if(![...select.options].some(o=>o.value===id)){
          const extra=document.createElement('option');extra.value=id;extra.textContent=task.title;
          select.add(extra);
        }
        select.value=id;updateManualActivityMode();openPanel('time');
        $('manualTimeForm').scrollIntoView({behavior:'smooth',block:'start'});
      }
      return;
    }
    if(b.dataset.jointApprove && staff()){
      const task=tasks.find(t=>t.id===id);
      if(!task||task.assigned_to===currentUser?.id)return;
      if(!confirm('Patvirtinti rezultatą ir visus dar nepatvirtintus šios užduoties laiko įrašus?'))return;
      return run(()=>client.rpc('gi_approve_result_with_time',{p_task_id:id}),
        rows=>'Patvirtintas darbo rezultatas ir '+Number(rows||0)+' laiko įrašų.');
    }
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
      const target=members.find(p=>p.id===choice);
      if(!target)return notice('Savanoris nepasiekiamas. Atnaujinkite sąrašą.',true);
      if(!confirm('Paskirti bandomąją užduotį žmogui „'+personName(target)+'“?'))return;
      if(choice===tasks.find(t=>t.id===id)?.assigned_to)
        return toast('Vykdytojas jau paskirtas. Nieko keisti nereikia.');
      return run(()=>client.rpc('gi_assign_task',{p_id:id,p_volunteer:choice}),
        'Užduotis priskirta: '+personName(target));
    }
    if(b.dataset.setDue && staff()){
      const input=[...document.querySelectorAll('[data-due]')].find(e=>e.dataset.due===id);
      const raw=input?.value||'',dt=raw?new Date(raw):null;
      if(dt&&Number.isNaN(dt.getTime()))return notice('Neteisinga termino data.',true);
      return run(()=>client.rpc('gi_set_task_due',{p_id:id,p_due:dt?dt.toISOString():null}));
    }
    const action=b.dataset.step;
    if(!action)return;
    let note=null;
    if(action==='return'||action==='decline'){
      note=prompt(action==='return'?'Kodėl grąžini užduotį taisyti?':'Kodėl atsisakai bandomosios užduoties?');
      if(!note||note.trim().length<3)return notice('Įrašykite bent 3 simbolių priežastį.',true);
    }
    if(action==='unassign'&&!confirm('Atšaukti paskyrimą? Užduotis grįš į bendrą fondą.'))return;
    const labels={claim:'Užduotis priskirta jums.',accept:'Užduotis priimta.',start:'Užduotis pradėta.',
      decline:'Užduotis grąžinta į bendrą fondą.',unassign:'Paskyrimas atšauktas.',
      publish:'Užduotis paskelbta fonde.',return:'Rezultatas grąžintas taisyti.'};
    run(()=>client.rpc('gi_task_action',{p_id:id,p_action:action,p_note:note}),labels[action]||'Užduotis atnaujinta.');
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
      const hours=Number(fd.get('hours')),minutes=Number(fd.get('minutes'));
      const total=hours*60+minutes;
      if(!Number.isInteger(hours)||!Number.isInteger(minutes)||hours<0||hours>12
        ||minutes<0||minutes>59||total<1||total>720)
        return notice('Įveskite nuo 1 min. iki 12 val., naudodami valandas ir minutes.',true);
      return run(()=>client.rpc('gi_log_minutes',{
        p_id:form.dataset.logTime,p_minutes:total,p_note:String(fd.get('note')||'')
      }));
    }
  });
  const handleTimeReviewClick=(event)=>{
    const b=event.target.closest('button');
    if(!b||!staff())return;
    const id=b.dataset.timeApprove||b.dataset.timeReturn;
    if(!id)return;
    const row=workLogs.find(x=>x.id===id);
    if(!row||row.volunteer_id===currentUser?.id)return;
    const action=b.dataset.timeApprove?'approve':'return';
    let note=null;
    if(action==='return'){
      note=prompt('Kodėl reikia patikslinti darbo laiko įrašą?');
      if(!note||note.trim().length<3)return notice('Nurodykite priežastį.',true);
    }else if(!confirm('Patvirtinti '+clockDuration(row.minutes)+' savanorystės laiką?'))return;
    return run(()=>client.rpc('gi_review_work_log',{p_id:id,p_action:action,p_note:note}),
      action==='approve'?'Savanorio darbo laikas patvirtintas.':'Laiko įrašas grąžintas patikslinti.');
  };
  $('workLogsList').addEventListener('click',handleTimeReviewClick);
  $('staffTimeLogs').addEventListener('click',handleTimeReviewClick);
  $('manualTimeForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(mutationInFlight||!currentUser||!approved())return;
    const hours=Number($('manualTimeHours').value),minutes=Number($('manualTimeMinutes').value);
    const total=hours*60+minutes,taskId=$('manualTimeTask').value||null;
    const title=$('manualTimeActivity').value.trim();
    if(!Number.isInteger(hours)||!Number.isInteger(minutes)||hours<0||hours>12
      ||minutes<0||minutes>59||total<1||total>720)
      return toast('Įveskite 1–720 min. valandomis ir minutėmis.',true);
    if(!taskId&&(title.length<5||title.length>160))
      return toast('Veiklai be užduoties nurodykite bent 5 simbolių pavadinimą.',true);
    const params={p_task_id:taskId,p_minutes:total,
      p_activity_title:taskId?null:title,p_note:$('manualTimeNote').value.trim()};
    const ok=await run(()=>client.rpc('gi_record_volunteer_time',params),
      'Pateikta '+clockDuration(total)+' patvirtinimui.');
    if(ok){
      $('manualTimeForm').reset();
      updateManualActivityMode();
    }
  });
  $('incidentClear').addEventListener('click',()=>{
    $('incidentForm').reset();
    $('incidentId').value='';
    notice('Galite kurti naują demonstracinį pranešimą.');
  });
  $('incidentsList').addEventListener('click',event=>{
    const b=event.target.closest('[data-edit-incident]');
    if(!b)return;
    const item=incidents.find(v=>v.id===b.dataset.editIncident);
    if(!item||item.reporter_id!==currentUser?.id||item.status!=='draft')return;
    $('incidentId').value=item.id;
    $('incidentDescription').value=item.description;
    $('incidentCategory').value=item.category;
    $('incidentEventState').value=item.event_state;
    $('incidentLat').value=item.latitude??'';
    $('incidentLon').value=item.longitude??'';
    $('incidentForm').scrollIntoView({behavior:'smooth',block:'start'});
  });
  $('incidentForm').addEventListener('submit',event=>{
    event.preventDefault();
    const button=event.submitter;
    const submit=button?.value==='submit';
    const desc=$('incidentDescription').value.trim();
    if(desc.length<5)return notice('Aprašykite bent 5 simboliais.',true);
    const lat=$('incidentLat').value.trim(),lon=$('incidentLon').value.trim();
    if((lat==='')!==(lon===''))return notice('Koordinatėms reikia abiejų reikšmių arba nė vienos.',true);
    const payload={
      p_id:$('incidentId').value||null,p_description:desc,
      p_category:$('incidentCategory').value,p_event_state:$('incidentEventState').value,
      p_lat:lat===''?null:Number(lat),p_lon:lon===''?null:Number(lon),
      p_submit:submit
    };
    run(async()=>{
      const result=await client.rpc('gi_save_incident',payload);
      if(!result.error){$('incidentForm').reset();$('incidentId').value='';}
      return result;
    });
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
      if(document.hidden)return;
      if(currentUser)refreshWorkspace();
      else if(signupWaiting)checkSignedInAfterEmail();
    });
    window.addEventListener('focus',()=>{
      if(document.hidden)return;
      if(currentUser)refreshWorkspace();
      else if(signupWaiting)checkSignedInAfterEmail();
    });
    setInterval(()=>{if(currentUser&&!document.hidden)refreshWorkspace()},180000);
  }else{
    notice('Nepavyko įkelti Supabase prisijungimo bibliotekos. Patikrink tinklą.',true);
  }
})();
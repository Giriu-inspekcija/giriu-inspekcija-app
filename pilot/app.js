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

  let nomination=null;
  let refreshFinished=Promise.resolve();
  const expiredSession=error=>['PGRST301','PGRST303','session_not_found'].includes(error?.code)
    || /JWT expired|token has expired|invalid JWT/i.test(error?.message||'');
  function endExpiredSession(){
    showLoggedOut();
    selectAuthMode('login');
    notice('Prisijungimo laikas baigėsi. Prisijunkite iš naujo.',true);
    client.auth.signOut({scope:'local'}).catch(()=>{});
  }
  let feedbackGroups=[],cases=[],documents=[],documentRequest=null,caseRequest=new Map();
  const taskHistoryCache=new Map();
  const taskEventLabels={create:'Sukurta',agent_propose:'DI pasiūlymas',propose:'Pasiūlyta',
    publish:'Paskelbta fonde',assign:'Priskirta',claim:'Pasiimta',accept:'Priimta',
    decline:'Atsisakyta',unassign:'Paskyrimas atšauktas',start:'Pradėta',
    submit:'Pateiktas rezultatas',approve:'Patvirtinta',return:'Grąžinta taisyti',
    set_due:'Terminas nustatytas',clear_due:'Terminas pašalintas',
    time_approve:'Laikas patvirtintas',time_return:'Laikas grąžintas'};
  const canWriteDocuments=()=>staff() || (profile?.role==='volunteer' && profile.can_prepare_documents);
  let reviewableLogs=new Set(), timeTotals={submitted:0,approved:0};
  let searchText='', ownerFilter='', dueFilter='all';
  let proposalRef=null, timeRequest=null;
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
    nomination=null;feedbackGroups=[];cases=[];documents=[];documentRequest=null;caseRequest.clear();
    taskHistoryCache.clear();
    $('documentList').replaceChildren();$('documentCreate').reset();
    $('incidentForm').reset();$('incidentId').value='';$('incidentsList').replaceChildren();
    reviewableLogs.clear();
    proposalRef=null;timeRequest=null;searchText='';ownerFilter='';dueFilter='all';
    $('taskSearchForm').reset();
    $('proposalForm').reset();
    $('manualTimeForm').reset();
    $('taskList').replaceChildren();
    $('workLogsList').replaceChildren();
    for(const id of ['staffTimeLogs','feedbackQueue','feedbackList','pendingMembers','batchReview','taskSummary','dueReminderButtons']){
      $(id).replaceChildren();
    }
    $('workspace').hidden=true;$('batchJson').value='';reviewedBatch=null;$('batchImport').disabled=true;
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
    const owner=currentUser.id;
    const {data,error} = await client.from('gi_profiles').select('id,display_name,role,registration_state,membership_intent,volunteer_rank,preferred_activity,region_label,can_prepare_documents')
      .eq('id',currentUser.id).maybeSingle();
    if(error) throw error;
    if(currentUser?.id!==owner)return;
    profile = data || {id:currentUser.id,role:'pending',display_name:null};
  }
  // Keep expanded controls, dirty drafts, and viewport stable after re-fetching data.
  function captureWorkspaceUi(){
    const active=document.activeElement;
    const anchor=active?.closest?.('[data-task],[data-document]');
    const docBodies=new Map();
    document.querySelectorAll('#documentList [data-document] textarea[data-body]').forEach(el=>{
      if(el.dataset.dirty==='true')docBodies.set(el.closest('[data-document]').dataset.document,el.value);
    });
    const controls=new Map();
    document.querySelectorAll('#taskList [data-due],#taskList [data-person]').forEach(el=>{
      if(!el.closest('details')?.open)return;
      const taskId=el.closest('[data-task]')?.dataset.task;
      if(taskId)controls.set(taskId+':'+(el.matches('[data-due]')?'due':'person'),el.value);
    });
    const results=new Map();
    document.querySelectorAll('#taskList form[data-submit-result]').forEach(form=>{
      const value=form.querySelector('[name="result"]')?.value||'';
      if(value)results.set(form.dataset.submitResult,value);
    });
    return {
      openKeys:[...document.querySelectorAll('#taskList details[data-ui-key][open]')].map(el=>el.dataset.uiKey),
      docBodies,results,controls,
      anchorType:anchor?.hasAttribute('data-task')?'task':anchor?.hasAttribute('data-document')?'document':null,
      anchorId:anchor?.dataset.task||anchor?.dataset.document||null,
      anchorTop:anchor?.getBoundingClientRect().top,
      scrollY:window.scrollY,panel:activePanel
    };
  }
  function restoreWorkspaceUi(state){
    if(!state)return;
    const keys=new Set(state.openKeys);
    document.querySelectorAll('#taskList details[data-ui-key]').forEach(el=>{
      if(keys.has(el.dataset.uiKey))el.open=true;
    });
    document.querySelectorAll('#taskList [data-due],#taskList [data-person]').forEach(el=>{
      const taskId=el.closest('[data-task]')?.dataset.task;
      if(!taskId)return;
      const key=taskId+':'+(el.matches('[data-due]')?'due':'person');
      if(state.controls.has(key))el.value=state.controls.get(key);
    });
    document.querySelectorAll('#taskList form[data-submit-result]').forEach(form=>{
      const value=state.results.get(form.dataset.submitResult);
      if(value!==undefined){const field=form.querySelector('[name="result"]');if(field)field.value=value;}
    });
    document.querySelectorAll('#documentList [data-document] textarea[data-body]').forEach(el=>{
      const id=el.closest('[data-document]').dataset.document;
      if(state.docBodies.has(id)){el.value=state.docBodies.get(id);el.dataset.dirty='true';}
    });
    if(state.panel!==activePanel)return;
    const anchor=state.anchorType==='task'
      ?[...document.querySelectorAll('#taskList [data-task]')].find(el=>el.dataset.task===state.anchorId)
      :state.anchorType==='document'
        ?[...document.querySelectorAll('#documentList [data-document]')].find(el=>el.dataset.document===state.anchorId)
        :null;
    if(anchor&&Number.isFinite(state.anchorTop)){
      const delta=anchor.getBoundingClientRect().top-state.anchorTop;
      if(Math.abs(delta)>3)window.scrollBy(0,delta);
    }else if(window.scrollY!==state.scrollY){
      const max=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
      window.scrollTo(0,Math.min(state.scrollY,max));
    }
  }
  async function refreshWorkspace({appendTasks = false} = {}) {
    if(!currentUser || loading) return false;
    const uiState=captureWorkspaceUi();
    loading = true;
    const actor=currentUser.id;
    let finish;
    refreshFinished=new Promise(resolve=>{finish=resolve;});
    try {
      await fetchProfile();
      if(currentUser?.id!==actor)return false;
      $('greeting').textContent = 'Darbo vieta';
      $('roleName').textContent = (profile.display_name?profile.display_name+' · ':'') + (roleNames[profile.role] || 'Laukia patvirtinimo') + (profile.volunteer_rank ? ' · '+({pradedantysis:'Pradedantysis',patyres:'Patyręs',vyriausias:'Vyriausias',regiono_vadas:'Regiono vadas'}[profile.volunteer_rank] || profile.volunteer_rank) : '');
      $('pendingView').hidden = approved();
      const regState=profile.registration_state||'active';
      $('pendingHeading').textContent=regState==='rejected'?'Registracija atmesta':regState==='withdrawn'?'Registracija atšaukta':'Laukiama koordinatoriaus patvirtinimo';
      $('pendingDescription').textContent=regState==='rejected'
        ?'Koordinatorius atmetė bandomąją registraciją. Jei tai klaida, kreipkitės info@giriuinspekcija.lt.'
        :regState==='withdrawn'?'Jūsų registracija sustabdyta. Norėdami ją atkurti, susisiekite su GI koordinatoriumi.'
        :'Paskyra aktyvi. Po patikros koordinatorius suteiks tinkamą vaidmenį.';
      $('withdrawRegistration').hidden=regState!=='active';
      $('teamNav').hidden=!staff();
      $('documentsNav').hidden=!canWriteDocuments();
      openPanel(activePanel);
      $('activateMaster').hidden = true;
      if(!approved()){
        const candidate=await client.rpc('gi_is_bootstrap_candidate');
        if(!candidate.error && candidate.data===true && regState==='active') $('activateMaster').hidden=false;
      }
      if(!approved())$('workspace').hidden=true;
      $('staffPanel').hidden = !staff();
      $('adminPanel').hidden = !staff();
      $('tasksHeading').textContent = staff() ? 'Organizacijos užduotys' : 'Mano užduotys';
      $('taskFilterPanel').hidden = !approved();
      $('memberSearchPanel').hidden = !staff();

      if(!approved()) return true;
      const pageArgs={
        p_before_created_at:appendTasks && taskCursor ? taskCursor.created_at : null,
        p_before_id:appendTasks && taskCursor ? taskCursor.id : null,
        p_limit:TASK_PAGE_SIZE+1,
        p_filter:taskFilter
      };
      const {data,error}=(searchText || ownerFilter || dueFilter!=='all')
        ? await client.rpc('gi_search_tasks_page',{...pageArgs,p_search:searchText,
          p_owner:ownerFilter==='mine'?currentUser.id:ownerFilter||null,p_due_filter:dueFilter})
        : await client.rpc('gi_list_tasks_page',pageArgs);
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
      const [queue,reminder]=await Promise.all([
        staff()?client.from('gi_feedback_review').select('id,reports,task_id,resolved_at,resolution,gi_feedback!example_id(category,message)').order('last_report_at',{ascending:false}).limit(60):Promise.resolve({data:[]}),
        client.rpc('gi_deadline_counts')
      ]);
      if(queue.error||reminder.error)throw queue.error||reminder.error;
      feedbackGroups=queue.data||[];
      const counts=reminder.data?.[0]||{};
      $('dueReminder').hidden=!Number(counts.overdue)&&!Number(counts.upcoming);
      $('dueReminderButtons').innerHTML=(Number(counts.overdue)?'<button class="outline" data-when="overdue">Pradelstos · '+Number(counts.overdue)+'</button>':'')
        +(Number(counts.upcoming)?'<button class="outline" data-when="week">Per 7 dienas · '+Number(counts.upcoming)+'</button>':'');
      const ownerSelect=$('taskOwnerFilter');
      ownerSelect.innerHTML='<option value="">Visi vykdytojai</option><option value="mine">Tik mano darbai</option>'
        +members.filter(m=>m.id!==currentUser.id && m.role!=='pending').map(m=>'<option value="'+escapeHTML(m.id)+'">'+escapeHTML(personName(m))+'</option>').join('');
      if(ownerFilter && ![...ownerSelect.options].some(o=>o.value===ownerFilter))ownerSelect.add(new Option('Pasirinktas vykdytojas',ownerFilter));
      ownerSelect.value=ownerFilter;
      const logFields='id,task_id,volunteer_id,minutes,note,activity_title,review_status,review_note,created_at,work_date,project_label,general_activity';
      const totals=await client.rpc('gi_my_time_totals');
      if(totals.error)throw totals.error;
      timeTotals=totals.data?.[0]||{submitted:0,approved:0};
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
      const ids=workLogs.filter(w=>w.review_status==='submitted').map(w=>w.id);
      const permissions=staff() && ids.length ? await client.rpc('gi_reviewable_logs',{p_ids:ids}) : {data:[]};
      if(permissions.error)throw permissions.error;
      reviewableLogs=new Set(permissions.data||[]);
      $('manualTimeDate').max=window.giDeadlines.inputValue(new Date()).slice(0,10);
      if(!$('manualTimeDate').value) $('manualTimeDate').value=$('manualTimeDate').max;
      const ownTaskResult=await client.from('gi_tasks')
        .select('id,title,status,updated_at')
        .eq('assigned_to',currentUser.id)
        .order('updated_at',{ascending:false}).limit(25);
      if(ownTaskResult.error)throw ownTaskResult.error;
      timeOwnTasks=ownTaskResult.data||[];
      renderManualTimeTaskOptions();
      const incidentResult=await client.from('gi_incidents')
        .select('id,reporter_id,description,category,event_state,latitude,longitude,status,created_at,observed_at')
        .order('created_at',{ascending:false}).limit(100);
      if(incidentResult.error)throw incidentResult.error;
      incidents=incidentResult.data||[];
      if(!$('incidentObserved').value)$('incidentObserved').value=window.giDeadlines.inputValue(new Date());
      const reviewer=admin()?await client.rpc('gi_reviewer_candidate'):{data:null};
      if(reviewer.error)throw reviewer.error;
      nomination=reviewer.data;
      const caseResult=staff() && incidents.length?await client.from('gi_cases').select('id,incident_id').in('incident_id',incidents.map(i=>i.id)):{data:[]};
      if(caseResult.error)throw caseResult.error;
      cases=caseResult.data||[];
      const docs=canWriteDocuments()?await client.from('gi_documents').select('id,title,body,phase,revision,author_id,task_id,case_id').order('updated_at',{ascending:false}).limit(50):{data:[]};
      if(docs.error)throw docs.error;
      documents=docs.data||[];
      if(currentUser?.id!==actor)return false;
      renderDocuments();
      renderTasks();
      renderWorkLogs();
      renderIncidents();
      renderPendingMembers();
      renderFeedback();
      $('workspace').hidden=false;
      restoreWorkspaceUi(uiState);
      return true;
    } catch(error) {
      if(currentUser?.id!==actor)return false;
      if(expiredSession(error)){endExpiredSession();return false;}
      notice('Nepavyko atnaujinti: ' + (error?.message || String(error)), true);
      return false;
    } finally {loading=false;finish();}
  }

  const panelTitles={tasks:'Darbai',time:'Valandos',incidents:'Įvykiai',documents:'Dokumentai',team:'Komanda',feedback:'Pastabos'};
  let feedbackOrigin='feedback';
  function openPanel(name) {
    if(!['tasks','time','incidents','documents','team','feedback'].includes(name))name='tasks';
    if(name==='documents'&&!canWriteDocuments())name='tasks';
    if(name==='team'&&!staff())name='tasks';
    activePanel=name;
    $('quickFeedback').hidden=name==='feedback'||!approved();
    for(const panel of ['tasks','time','incidents','documents','team','feedback']){
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
    if(button.dataset.nav==='feedback')feedbackOrigin=activePanel;
    openPanel(button.dataset.nav);
    if(button.dataset.nav==='feedback')$('feedbackContext').textContent='Pastaba apie: '+(panelTitles[feedbackOrigin]||'Programėlė');
  });
  $('quickFeedback').addEventListener('click',()=>{
    feedbackOrigin=activePanel;
    openPanel('feedback');
    $('feedbackContext').textContent='Pastaba apie: '+(panelTitles[feedbackOrigin]||'Programėlė');
    $('feedbackForm').querySelector('textarea[name="message"]').focus({preventScroll:true});
    $('feedbackForm').scrollIntoView({block:'start',behavior:'auto'});
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
    $('myTimeSummary').textContent='Pateikta patvirtinti: '+clockDuration(Number(timeTotals.submitted))
      +' · Patvirtinta iš viso: '+clockDuration(Number(timeTotals.approved));
    const entry=w=>{
      const task=timeOwnTasks.find(t=>t.id===w.task_id)||tasks.find(t=>t.id===w.task_id);
      const owner=members.find(p=>p.id===w.volunteer_id);
      const title=w.activity_title||task?.title||'Bandomasis darbas';
      return '<article class="card"><b>'+escapeHTML(title)+'</b>'
        +(w.volunteer_id!==currentUser?.id?'<p class="small">Vykdytojas: '+escapeHTML(owner?personName(owner):'Savanoris')+'</p>':'')
        +'<p class="small">'+escapeHTML(w.work_date||window.giDeadlines.inputValue(w.created_at).slice(0,10))
        +(w.project_label?' · '+escapeHTML(w.project_label):'')+'</p>'
        +'<p>'+escapeHTML(clockDuration(w.minutes))+' · '
        +escapeHTML({submitted:'Pateikta',approved:'Patvirtinta',returned:'Grąžinta taisyti'}[w.review_status]||w.review_status)
        +'</p>'+(w.note?'<p class="small">'+escapeHTML(w.note)+'</p>':'')
        +(w.review_note?'<p class="small">Koordinatoriaus pastaba: '+escapeHTML(w.review_note)+'</p>':'')
        +(w.review_status==='returned'?'<p class="small">Patikslinkite pateikdami naują įrašą aukščiau.</p>':'')
        +(reviewableLogs.has(w.id)
          ?'<div class="actions"><button type="button" data-time-approve="'+escapeHTML(w.id)+'">Patvirtinti laiką</button>'
           +'<button type="button" class="outline" data-time-return="'+escapeHTML(w.id)+'">Grąžinti taisyti</button></div>':'')
        +'</article>';
    };
    $('workLogsList').innerHTML=mine.length?mine.map(entry).join('')
      :'<p class="card">Jūsų pateiktų valandų dar nėra. Galite įrašyti ir atskirą savanorystės veiklą.</p>';
    const others=staff()?workLogs.filter(w=>w.volunteer_id!==currentUser?.id&&reviewableLogs.has(w.id)):[];
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
        +(v.observed_at?'<p class="small">'+escapeHTML(window.giDeadlines.display(v.observed_at))+' (Vilniaus laiku)</p>':'')
        +'<button class="outline" type="button" data-photos="'+escapeHTML(v.id)+'">Nuotraukos</button><div data-gallery></div>'
        +caseActions(v)
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
        +(p.id===nomination?'<button type="button" data-appoint-reviewer="'+id+'">Suteikti valandų tvirtinimo teisę</button>':'')
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
    $('feedbackQueuePanel').hidden=!staff();
    $('feedbackQueue').innerHTML=feedbackGroups.map(g=>'<article class="card"><b>'+escapeHTML(g.gi_feedback?.category)+'</b>'
      +'<p>'+escapeHTML(g.gi_feedback?.message)+'</p><p class="small">Pranešimų: '+Number(g.reports)+'</p>'
      +(g.resolved_at?'<p>Sprendimas: '+escapeHTML(g.resolution)+'</p>':'<div class="actions">'
        +(g.task_id?'<span>Užduotis '+escapeHTML(g.task_id.slice(0,8))+'</span>':'<button type="button" data-feedback-task="'+escapeHTML(g.id)+'">Sukurti užduotį</button>')
        +'<button type="button" class="outline" data-feedback-resolve="'+escapeHTML(g.id)+'">Užrašyti sprendimą</button></div>')+'</article>').join('')
      ||'<p class="small">Pastabų dar nėra.</p>';
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
        markup+='<details data-ui-key="assign-'+id+'"><summary><b>Priskirti savanoriui</b></summary>'
          +'<div class="form-inline"><select aria-label="Pasirinkite vykdytoją" data-person="'+id+'">'
          +'<option value="">Pasirinkite savanorį</option>'
          +selectable.map(m=>'<option value="'+escapeHTML(m.id)+'"'+(task.assigned_to===m.id?' selected':'')+'>'
            +escapeHTML(personName(m))+' ('+escapeHTML(memberEmails[m.id]?.email||'')+')</option>').join('')
          +'</select><button type="button" data-assign="'+id+'">Priskirti</button></div>'
          +'</details>'
          +(task.status==='assigned'?'<div class="actions"><button class="outline" type="button" data-step="unassign" data-id="'+id+'">Atšaukti paskyrimą</button></div>':'')
          +safeButton;
      }
    }
    if(staff() && ['proposed','pool','assigned','accepted','in_progress','returned'].includes(task.status)){
      markup+='<details data-ui-key="due-'+id+'"><summary>'+ (task.due_at?'Keisti terminą':'Nustatyti terminą') +'</summary>'
        +'<label class="field">Data ir laikas Vilniuje<input aria-label="Užduoties terminas" type="datetime-local" data-due="'+id+'"'
        +(task.due_at?' value="'+window.giDeadlines.inputValue(task.due_at)+'"':'')+'></label>'
        +'<div class="actions"><button type="button" data-set-due="'+id+'">Išsaugoti terminą</button>'
        +(task.due_at?'<button class="outline" type="button" data-clear-due="'+id+'">Pašalinti terminą</button>':'')
        +'</div></details>';
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
      markup+='<p class="small">Galite kartu patvirtinti jums leidžiamus laiko įrašus arba atskirai peržiūrėti valandas.</p>'
        +'<div class="actions"><button type="button" data-joint-approve="'+id+'">'
        +'Patvirtinti rezultatą ir laiką</button>'
        +'<button type="button" class="outline" data-step="approve" data-id="'+id+'">Patvirtinti tik rezultatą</button>'
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
        const end=new Date(t.due_at),late=end.getTime()<Date.now()&&!['approved','submitted'].includes(t.status);
        due='<p class="small"><b>Terminas:</b> '+escapeHTML(window.giDeadlines.display(end)+' (Vilniaus laiku)')
          +(late?' · Terminas praėjęs':'')+'</p>';
      }
      const description=t.details?.length>260
        ?'<p class="task-description">'+escapeHTML(t.details.slice(0,220))+'…</p>'
          +'<details data-ui-key="description-'+escapeHTML(t.id)+'"><summary>Rodyti visą aprašymą</summary>'
          +'<p class="task-description">'+escapeHTML(t.details)+'</p></details>'
        :'<p class="task-description">'+escapeHTML(t.details||'')+'</p>';
      return '<article class="task" data-task="'+escapeHTML(t.id)+'">'
        +'<div class="row"><span class="tag '+escapeHTML(t.status)+'">'
          +escapeHTML(statusNames[t.status]||t.status)+'</span>'
        +'<span class="small">'+escapeHTML(t.priority==='high'?'Svarbu':t.priority==='low'?'Maža svarba':'Įprasta')+'</span></div>'
        +'<h3>'+escapeHTML(t.title)+'</h3>'+description+due
        +(staff()?'<p class="small">Vykdytojas: '+escapeHTML(owner?personName(owner):t.assigned_to?'Priskirtas savanoris':'Nepaskirta')+'</p>':'')
        +(t.assigned_to===currentUser?.id?'<p class="small"><b>Paskirta man</b></p>':'')
        +(t.candidate_safe?'<p class="small">Kandidatui leista demonstracinė užduotis</p>':'')
        +(t.feedback_text?'<p class="alert">Koordinatoriaus pastaba: '+escapeHTML(t.feedback_text)+'</p>':'')
        +(t.result_text?'<p class="small"><b>Rezultatas:</b> '+escapeHTML(t.result_text)+'</p>':'')
        +(t.case_id?'<p class="small">Atvejis '+escapeHTML(t.case_id.slice(0,8))+'</p>':'')
        +buttonsFor(t)+timeEntry(t)
        +'<details class="task-actions-more" data-ui-key="history-'+escapeHTML(t.id)+'">'
        +'<summary>Veiksmų istorija</summary>'
        +'<button type="button" class="ghost" data-load-history="'+escapeHTML(t.id)+'">Rodyti / atnaujinti istoriją</button>'
        +'<div data-task-history="'+escapeHTML(t.id)+'" class="small">'
        +(taskHistoryCache.has(t.id)?taskHistoryCache.get(t.id):'Atverkite istoriją, jei reikia matyti ankstesnius veiksmus.')
        +'</div></details></article>';
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
    toast('Išsaugoma…');
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
      if(expiredSession(error)){endExpiredSession();return false;}
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
    if(loading)await refreshFinished;
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
  $('dueReminderButtons').addEventListener('click',e=>{
    const button=e.target.closest('[data-when]');
    if(!button||loading)return;
    $('taskStatusFilter').value='assigned';$('taskSearch').value='';$('taskDueFilter').value=button.dataset.when;
    $('taskOwnerFilter').value='mine';$('taskSearchForm').requestSubmit();
  });
  $('feedbackQueue').addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||!staff())return;
    const create=!!b.dataset.feedbackTask, id=b.dataset.feedbackTask||b.dataset.feedbackResolve;
    const title=create?prompt('Koks užduoties pavadinimas?'):null;
    if(create&&(!title||title.trim().length<3))return;
    const note=prompt(create?'Aprašykite darbą vykdytojui be asmens duomenų.':'Kaip išspręsta pastaba?');
    if(!note||note.trim().length<(create?5:3))return;
    return run(()=>client.rpc('gi_review_feedback_group',{p_id:id,p_action:create?'task':'resolve',p_title:title,p_note:note,p_priority:'normal'}),
      create?'Sukurta susieta užduotis.':'Sprendimas išsaugotas.');
  });
  $('taskSearchForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(!approved()||loading)return;
    taskFilter=$('taskStatusFilter').value;
    searchText=$('taskSearch').value.trim();ownerFilter=$('taskOwnerFilter').value;dueFilter=$('taskDueFilter').value;
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
      const deadline=String(fd.get('due')||'');
      if(!proposalRef)proposalRef=crypto.randomUUID();
      const result=await client.rpc('gi_submit_task',{
        p_due:deadline?window.giDeadlines.toInstant(deadline):null,
        p_title:String(fd.get('title')||''),p_details:String(fd.get('details')||''),
        p_priority:String(fd.get('priority')||'normal'),
        p_source_ref:'web-'+proposalRef
      });
      if(!result.error){form.reset();proposalRef=null;}
      return result;
    },'Užduotis sukurta.');
  });
  $('feedbackForm').addEventListener('submit',event => {
    event.preventDefault();
    if(!currentUser || !approved()) return;
    const form=event.currentTarget,data=new FormData(form);
    const raw=String(data.get('message')||'').trim();
    const origin=feedbackOrigin==='feedback'?'':(panelTitles[feedbackOrigin]||'');
    const message=origin?'['+origin+'] '+raw:raw;
    if(message.length>1500)return toast('Pastaba per ilga – sutrumpinkite iki 1500 simbolių.',true);
    run(async()=>{
      const result=await client.from('gi_feedback').insert({
        reporter_id:currentUser.id,
        category:String(data.get('category')||'pasiulymas'),
        message
      });
      if(!result.error){form.reset();feedbackOrigin='feedback';}
      return result;
    },'Pastaba užregistruota. Ačiū!');
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
      ||btn.dataset.rankChange||btn.dataset.docPermission||btn.dataset.appointReviewer
      ||btn.dataset.rejectRegistration||btn.dataset.restoreRegistration||btn.dataset.purgeInvalid;
    if(!id || id===currentUser?.id)return;
    const person=members.find(p=>p.id===id);
    const email=memberEmails[id]?.email||'';
    if(btn.dataset.appointReviewer){
      if(id!==nomination || !confirm('Ar patikrinote asmens tapatybę? Suteikti '+email+' savanorių laiko tvirtinimo teisę?'))return;
      return run(()=>client.rpc('gi_appoint_reviewer',{p_user:id}),'Valandų tvirtinimo teisė suteikta.');
    }
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
  $('taskList').addEventListener('click',async event=>{
    const b=event.target.closest('button');
    if(!b||loading||mutationInFlight)return;
    if(b.dataset.loadHistory){
      const id=b.dataset.loadHistory;
      const box=b.closest('details')?.querySelector('[data-task-history]');
      if(!box||!tasks.some(t=>t.id===id))return;
      b.disabled=true;
      try{
        const {data,error}=await client.from('gi_task_events')
          .select('action,note,created_at,actor_id').eq('task_id',id)
          .order('created_at',{ascending:false}).limit(40);
        if(error)throw error;
        const html=(data||[]).length?(data||[]).map(row=>
          '<p><b>'+escapeHTML(taskEventLabels[row.action]||row.action)+'</b> · '
          +escapeHTML(window.giDeadlines.display(row.created_at))
          +(row.note?'<span> – '+escapeHTML(row.note)+'</span>':'')+'</p>'
        ).join(''):'<p>Šiai užduočiai įvykių dar neužfiksuota.</p>';
        taskHistoryCache.set(id,html);box.innerHTML=html;
      }catch(error){toast('Užduoties istorijos nepavyko įkelti: '+(error.message||'klaida'),true);}
      finally{b.disabled=false;}
      return;
    }
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
      if(!confirm('Patvirtinti rezultatą ir jums leidžiamus šios užduoties laiko įrašus?'))return;
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
    if((b.dataset.setDue || b.dataset.clearDue) && staff()){
      const taskId=b.dataset.setDue || b.dataset.clearDue;
      const input=b.closest('details').querySelector('[data-due]');
      let due=null;
      if(b.dataset.setDue){
        try { due=window.giDeadlines.toInstant(input.value); }
        catch(error){input.focus();return toast(error.message,true);}
      }else if(!confirm('Pašalinti šios užduoties terminą?'))return;
      const previous=tasks.find(t=>t.id===taskId)?.due_at||null;
      return run(()=>client.rpc('gi_change_task_due',{p_id:taskId,p_expected:previous,p_due:due}),
        due?'Terminas išsaugotas: '+window.giDeadlines.display(due)+' (Vilniaus laiku).':'Terminas pašalintas.');
    }
    const action=b.dataset.step;
    if(!action)return;
    let note=null;
    if(action==='return'||action==='decline'){
      note=prompt(action==='return'?'Kodėl grąžini užduotį taisyti?':'Kodėl atsisakai bandomosios užduoties?');
      if(!note||note.trim().length<3)return notice('Įrašykite bent 3 simbolių priežastį.',true);
    }
    if(action==='approve'&&!confirm('Patvirtinti tik darbo rezultatą? Valandas galėsite peržiūrėti atskirai.'))return;
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
    if(!row||!reviewableLogs.has(row.id))return;
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
      p_activity_title:taskId?null:title,p_note:$('manualTimeNote').value.trim(),
      p_date:$('manualTimeDate').value,p_project:$('timeProject').value.trim()||null,
      p_general:!$('timeProject').value.trim()};
    const signature=JSON.stringify(params);
    if(timeRequest?.signature!==signature)timeRequest={signature,id:crypto.randomUUID()};
    params.p_request=timeRequest.id;
    const ok=await run(()=>client.rpc('gi_record_dated_time',params),
      'Pateikta '+clockDuration(total)+' patvirtinimui.');
    if(ok){
      timeRequest=null;
      $('manualTimeForm').reset();
      $('manualTimeDate').value=$('manualTimeDate').max;
      updateManualActivityMode();
    }
  });
  function caseActions(incident){
    if(!staff()||incident.status!=='submitted')return '';
    const item=cases.find(c=>c.incident_id===incident.id);
    if(!item)return '<button type="button" data-open-case="'+escapeHTML(incident.id)+'">Pradėti atvejo patikrą</button>';
    return '<details><summary>Atvejo užduotys</summary><p class="small">Atvejis '+escapeHTML(item.id.slice(0,8))+'</p>'
      +'<form data-case-task="'+escapeHTML(item.id)+'"><label class="field">Užduoties pavadinimas<input name="title" required minlength="3" maxlength="140"></label>'
      +'<label class="field">Ką reikia patikrinti?<textarea name="details" required minlength="5" maxlength="6000"></textarea></label>'
      +'<button type="submit">Sukurti susietą užduotį</button></form></details>';
  }
  const templates={
    request:'Adresatas\n\nKokios informacijos prašome\n\nPatikrinti faktai ir šaltiniai\n\nKokį atsakymą prašome pateikti',
    observation:'Patikros vieta ir data\n\nKas pastebėta\n\nKokiais įrodymais remiamės\n\nSiūlomas tolesnis veiksmas'
  };
  const docPhases={draft:'Juodraštis',changes:'Grąžinta taisyti',review:'Peržiūrima',ready:'Parengta pasirašyti'};
  function renderDocuments(){
    const select=$('documentTask'),previous=select.value;
    const choices=staff()?tasks:timeOwnTasks;
    select.innerHTML='<option value="">Savarankiškas dokumentas</option>'+choices.map(t=>
      '<option value="'+escapeHTML(t.id)+'">'+escapeHTML(t.title)+'</option>').join('');
    if(choices.some(t=>t.id===previous))select.value=previous;
    const caseSelect=$('documentCase'),chosenCase=caseSelect.value;
    $('documentCaseField').hidden=!staff();
    caseSelect.innerHTML='<option value="">Be atskiro atvejo (arba pagal užduotį)</option>'
      +cases.slice(0,100).map(c=>{
        const incident=incidents.find(i=>i.id===c.incident_id);
        const label=incident?.description?.slice(0,75)||'Atvejis '+c.id.slice(0,8);
        return '<option value="'+escapeHTML(c.id)+'">'+escapeHTML(label)+'</option>';
      }).join('');
    if(cases.some(c=>c.id===chosenCase))caseSelect.value=chosenCase;
    $('documentList').innerHTML=documents.map(d=>{
      const own=d.author_id===currentUser.id,editable=own&&['draft','changes'].includes(d.phase);
      const reviewer=staff()&&!own&&d.phase==='review';
      const linked=choices.find(t=>t.id===d.task_id);
      return '<article class="card" data-document="'+escapeHTML(d.id)+'"><h3>'+escapeHTML(d.title)+'</h3>'
        +'<p class="small">'+docPhases[d.phase]+' · '+d.revision+' versija'
        +(linked?' · '+escapeHTML(linked.title):'')
        +(d.case_id?' · Atvejis '+escapeHTML(d.case_id.slice(0,8)):'')+'</p>'
        +(editable?'<label class="field">Dokumento tekstas<textarea data-body maxlength="30000">'+escapeHTML(d.body)+'</textarea></label>'
          +'<div class="actions"><button class="outline" data-doc-action="save">Išsaugoti</button>'
          +'<button data-doc-action="submit">Pateikti peržiūrai</button></div>'
          :'<p style="white-space:pre-wrap">'+escapeHTML(d.body)+'</p>')
        +(reviewer?'<div class="actions"><button data-doc-action="approve">Patvirtinti pasirašymui</button>'
          +'<button class="outline" data-doc-action="return">Grąžinti rengėjui</button></div>':'')
        +'<div class="actions"><button class="outline" data-doc-export="docx">Atsisiųsti DOCX</button>'
        +'<button class="outline" data-doc-export="print">Spausdinti / PDF</button></div>'
        +'<button class="outline" data-doc-history>Versijų istorija</button><div data-history></div></article>';
    }).join('')||'<p class="small">Dokumentų dar nėra.</p>';
  }
  $('documentCreate').addEventListener('submit',event=>{
    event.preventDefault();
    const form=event.currentTarget,data=new FormData(form);
    if(!documentRequest)documentRequest=crypto.randomUUID();
    run(async()=>{
      const result=await client.rpc('gi_document_step',{p_id:documentRequest,p_revision:0,p_action:'create',
        p_title:data.get('title'),p_body:templates[data.get('template')],
        p_task:data.get('task')||null,p_case:data.get('case')||null});
      if(!result.error){documentRequest=null;form.reset();}
      return result;
    },'Juodraštis sukurtas.');
  });
  $('documentAiPrompt').addEventListener('click',async()=>{
    const form=$('documentCreate'),data=new FormData(form);
    const title=String(data.get('title')||'').trim()||'Bandomasis GI raštas';
    const template=data.get('template')==='observation'?'Patikros pažyma':'Informacijos prašymas';
    const task=tasks.find(t=>t.id===data.get('task'));
    const caseId=String(data.get('case')||'').trim();
    const prompt=[
      'BANDOMASIS VšĮ „Girių inspekcija“ dokumento rengimas. Naudok tik išgalvotus duomenis.',
      'Rašto rūšis: '+template+'.',
      'Tema: '+title+'.',
      task?'Susieta demonstracinė užduotis: '+task.title+'.':'',
      caseId?'Susietas bandomasis atvejis: '+caseId.slice(0,8)+'.':'',
      'Prieš siūlydamas tekstą pasakyk, kokių faktų, šaltinių ir dokumentų trūksta.',
      'Neišgalvok teisės aktų, dokumentų numerių, koordinačių ar GI pasiekimų.',
      'Vadovaukis tik patikrinta informacija, išskirk nepatikrintus teiginius.',
      'GI rašto šablonas (Google Drive, reikia teisėtos prieigos):',
      'https://docs.google.com/document/d/1UplisHnkyUJ5qVytzW1C4nYxvKg5bXb4FJjHwI1_UUM/edit',
      'Tai tik juodraštis: nieko nepasirašyk ir nesiųsk.'
    ].filter(Boolean).join('\n');
    try{
      if(!navigator.clipboard?.writeText)throw Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(prompt);
      toast('Bandomoji užklausa nukopijuota. Įklijuok ją ChatGPT ir patikrink šaltinius.');
    }catch{
      window.prompt('Nukopijuok bandomąją užklausą:',prompt);
    }
  });
  $('documentList').addEventListener('input',e=>{if(e.target.matches('[data-body]'))e.target.dataset.dirty='true';});
  $('documentList').addEventListener('click',async event=>{
    const button=event.target.closest('button'),card=button?.closest('[data-document]');
    if(!card)return;
    const doc=documents.find(d=>d.id===card.dataset.document);
    if(!doc)return;
    if(button.dataset.docExport){
      const body=card.querySelector('[data-body]')?.value??doc.body;
      if(button.dataset.docExport==='docx')window.giDocumentExport.docx(doc.title,body);
      else window.giDocumentExport.printDocument(doc.title,body);
      return;
    }
    if(button.hasAttribute('data-doc-history')){
      const box=card.querySelector('[data-history]');
      button.disabled=true;
      try{
        const {data,error}=await client.from('gi_document_versions').select('revision,phase,body,note,recorded_at')
          .eq('document_id',doc.id).order('revision',{ascending:false}).limit(50);
        if(error)throw error;
        box.innerHTML=data.map(v=>'<details><summary>'+v.revision+' · '+docPhases[v.phase]+' · '
          +escapeHTML(window.giDeadlines.display(v.recorded_at))+'</summary>'
          +(v.note?'<p>'+escapeHTML(v.note)+'</p>':'')+'<p style="white-space:pre-wrap">'+escapeHTML(v.body)+'</p></details>').join('');
      }catch(e){toast('Istorija nepasiekiama: '+e.message,true);}finally{button.disabled=false;}
      return;
    }
    const action=button.dataset.docAction;
    if(!action)return;
    const note=action==='return'?prompt('Ką reikia pataisyti?'):null;
    if(action==='return'&&(!note||note.trim().length<3))return;
    return run(()=>client.rpc('gi_document_step',{p_id:doc.id,p_revision:doc.revision,p_action:action,
      p_body:card.querySelector('[data-body]')?.value??null,p_note:note}),
      {save:'Versija išsaugota.',submit:'Dokumentas perduotas peržiūrai.',return:'Grąžinta rengėjui.',approve:'Dokumentas parengtas pasirašyti.'}[action]);
  });
  function resetIncident(){
    $('incidentForm').reset();$('incidentId').value='';
    $('incidentObserved').value=window.giDeadlines.inputValue(new Date());
  }
  $('incidentClear').addEventListener('click',resetIncident);
  const photos=()=>client.storage.from('gi-pilot-incident-photos');
  async function photoSlots(id){
    const result=await photos().list(id,{limit:10,sortBy:{column:'name',order:'asc'}});
    if(result.error)throw result.error;
    return result.data.map(f=>f.name);
  }
  const assignedSlots=new WeakMap();
  async function uploadPhotos(id,files){
    if(!files.length)return;
    const occupied=new Set(await photoSlots(id));
    for(const file of files){
      let slot=assignedSlots.get(file);
      if(slot?.id!==id)slot=null;
      if(!slot){
        const name=Array.from({length:10},(_,n)=>String(n+1).padStart(2,'0')).find(n=>!occupied.has(n));
        if(!name)throw Error('Šiam pranešimui jau pridėta 10 vaizdų.');
        slot={id,name};assignedSlots.set(file,slot);
      }
      const path=id+'/'+slot.name;
      if(occupied.has(slot.name)){
        const saved=await photos().download(path);
        if(saved.error)throw saved.error;
        const digest=async blob=>new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())).join(',');
        if(await digest(saved.data)!==await digest(file)){
          assignedSlots.delete(file);throw Error('Nuotraukos vieta jau užimta. Pakartokite pateikimą.');
        }
      }else{
        const result=await photos().upload(path,file,{contentType:file.type,upsert:false});
        if(result.error)throw result.error;
      }
      occupied.add(slot.name);
    }
  }
  $('incidentsList').addEventListener('submit',event=>{
    const form=event.target;
    if(!form.dataset.caseTask)return;
    event.preventDefault();
    const data=new FormData(form),caseId=form.dataset.caseTask;
    if(!caseRequest.has(caseId))caseRequest.set(caseId,crypto.randomUUID());
    run(async()=>{
      const result=await client.rpc('gi_case_task',{p_case:caseId,p_ref:caseRequest.get(caseId),p_title:data.get('title'),p_details:data.get('details')});
      if(!result.error)caseRequest.delete(caseId);
      return result;
    },'Užduotis sukurta. Ją rasite užduočių skiltyje.');
  });
  $('incidentsList').addEventListener('click',async event=>{
    const b=event.target.closest('button');
    if(!b)return;
    if(b.dataset.openCase)return run(()=>client.rpc('gi_open_case',{p_incident:b.dataset.openCase}),'Atvejo patikra pradėta.');
    if(b.dataset.removePhoto){
      if(!confirm('Pašalinti šią nuotrauką iš juodraščio?'))return;
      return run(()=>photos().remove([b.dataset.removePhoto]),'Nuotrauka pašalinta iš juodraščio.');
    }
    if(b.dataset.photos){
      b.disabled=true;
      try{
        const id=b.dataset.photos,box=b.nextElementSibling,names=await photoSlots(id);
        box.replaceChildren();
        if(!names.length)box.textContent='Nuotraukų nėra.';
        for(const name of names){
          const {data,error}=await photos().createSignedUrl(id+'/'+name,120);
          if(error)throw error;
          const img=document.createElement('img');img.src=data.signedUrl;img.alt='Pranešimo nuotrauka '+name;
          img.loading='lazy';img.width=160;img.style.maxWidth='100%';box.append(img);
          if(incidents.some(i=>i.id===id && i.reporter_id===currentUser.id && i.status==='draft')){
            const remove=document.createElement('button');remove.type='button';remove.className='outline';
            remove.dataset.removePhoto=id+'/'+name;remove.textContent='Pašalinti nuotrauką '+name;box.append(remove);
          }
        }
      }catch(e){toast('Nuotraukos nepasiekiamos: '+e.message,true);}finally{b.disabled=false;}
      return;
    }
    const item=incidents.find(v=>v.id===b.dataset.editIncident);
    if(!item||item.reporter_id!==currentUser?.id||item.status!=='draft')return;
    resetIncident();
    $('incidentId').value=item.id;$('incidentDescription').value=item.description;
    $('incidentCategory').value=item.category;$('incidentEventState').value=item.event_state;
    $('incidentCoords').value=item.latitude===null?'':item.latitude+', '+item.longitude;
    $('incidentObserved').value=window.giDeadlines.inputValue(item.observed_at||item.created_at);
    $('incidentForm').scrollIntoView({behavior:'smooth',block:'start'});
  });
  $('incidentForm').addEventListener('submit',event=>{
    event.preventDefault();
    const submit=event.submitter?.value==='submit',desc=$('incidentDescription').value.trim();
    const raw=$('incidentCoords').value.trim();
    const coordinates=raw?raw.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/):null;
    if(raw&&(!coordinates||Math.abs(Number(coordinates[1]))>90||Math.abs(Number(coordinates[2]))>180))
      return toast('Įveskite platumą ir ilgumą, pvz., 55.000, 24.000.',true);
    const files=Array.from($('incidentPhotos').files);
    if(files.length>10 || files.some(f=>f.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(f.type)))
      return toast('Pasirinkite iki 10 JPG, PNG arba WebP failų, po 5 MB.',true);
    if(!$('incidentId').value)$('incidentId').value=crypto.randomUUID();
    const payload={p_id:$('incidentId').value,p_description:desc,p_category:$('incidentCategory').value,
      p_event_state:$('incidentEventState').value,p_lat:coordinates?Number(coordinates[1]):null,p_lon:coordinates?Number(coordinates[2]):null};
    run(async()=>{
      const draft=await client.rpc('gi_incident_draft',{...payload,p_observed:window.giDeadlines.toInstant($('incidentObserved').value)});
      if(draft.error)throw draft.error;
      await uploadPhotos(payload.p_id,files);
      if(submit){
        const sent=await client.rpc('gi_save_incident',{...payload,p_submit:true});
        if(sent.error)throw sent.error;
      }
      resetIncident();
    },submit?'Pranešimas pateiktas patikrai.':'Juodraštis išsaugotas.');
  });
  function refreshWhenIdle(){
    // A native date picker can blur the window; replacing its card discards the edit.
    if(mutationInFlight || document.querySelector('#taskList details[open]') ||
       document.activeElement?.closest('#workspace form,#documentList [data-body]') || document.querySelector('#documentList textarea[data-dirty]'))return;
    refreshWorkspace();
  }
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
      if(currentUser)refreshWhenIdle();
      else if(signupWaiting)checkSignedInAfterEmail();
    });
    window.addEventListener('focus',()=>{
      if(document.hidden)return;
      if(currentUser)refreshWhenIdle();
      else if(signupWaiting)checkSignedInAfterEmail();
    });
    setInterval(()=>{if(currentUser&&!document.hidden)refreshWhenIdle()},180000);
  }else{
    notice('Nepavyko įkelti Supabase prisijungimo bibliotekos. Patikrink tinklą.',true);
  }
})();
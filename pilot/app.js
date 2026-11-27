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
  let currentUser = null, profile = null, members = [], tasks = [], agentProposals = [], feedback = [], workLogs = [], incidents = [], memberEmails = {}, loading = false, activePanel = 'tasks';
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
  const taskHistoryRequests=new Set();
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
  let lastControl=null;
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');
    if(b&&!b.closest('#decision'))lastControl=b;
  },true);
  document.addEventListener('submit',event=>{
    if(event.submitter&&!event.target.closest('#decision'))lastControl=event.submitter;
  },true);
  function busy(button,label){
    if(!button)return ()=>{};
    const text=button.textContent,disabled=button.disabled;
    button.disabled=true;button.setAttribute('aria-busy','true');button.textContent=label;
    return ()=>{button.textContent=text;button.disabled=disabled;button.removeAttribute('aria-busy');};
  }
  function ask(message,options={}){
    const dialog=$('decision'),entry=options.input===true;
    if(dialog.open)return Promise.resolve(null);
    const action=options.action||lastControl?.textContent.trim()||'Patvirtinti';
    $('decisionTitle').textContent=action;
    $('decisionText').textContent=message;
    $('decisionField').hidden=!entry;
    $('decisionInput').value=options.value||'';
    $('decisionInput').required=entry;
    $('decisionSubmit').textContent=action;dialog.returnValue='cancel';
    return new Promise(resolve=>{
      dialog.addEventListener('close',()=>resolve(dialog.returnValue==='accept'?(entry?$('decisionInput').value:true):null),{once:true});
      dialog.showModal();
      if(entry)$('decisionInput').focus();else dialog.querySelector('[value=cancel]').focus();
    });
  }
  async function copyText(value,label){
    try{await navigator.clipboard.writeText(value);return true;}
    catch{await ask('Pažymėkite ir nukopijuokite tekstą.',{action:label,input:true,value});return false;}
  }
  function showTaskToastLink(id){
    // Visible only after a confirmed server mutation; no additional privileges.
    if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return;
    const host=$('actionToast');
    if(host.hidden||host.classList.contains('error'))return;
    const url=new window.URL(location.pathname,location.origin);
    url.searchParams.set('task',id);
    const a=document.createElement('a');
    a.href=url.href;a.dataset.thread='task';a.dataset.key=id;
    a.textContent='Atverti užduotį';
    host.append(document.createTextNode(' · '),a);
    if(toastTimer)clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{host.hidden=true;toastTimer=null;},11000);
  }
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
  const incidentCategoryLabel={cutting:'Kirtimai',timber_truck:'Medienos vežimas',pollution:'Tarša',tree_damage:'Medžių pažeidimai',waste:'Atliekos',other:'Kita',unknown:'Nežinau'};
  const thread=window.giTeamThread({client,user:()=>currentUser,isStaff:staff,role:()=>profile?.role,html:escapeHTML,
    when:value=>window.giDeadlines.display(value),statuses:statusNames,actions:taskEventLabels,
    categories:incidentCategoryLabel,busy,ask,copyText,refresh:refreshWorkspace});
  const incidentLocation=window.giIncidentLocation();
  let signInFlight=null, feedbackSending=false, feedbackRetry=null;
  function showLoggedOut() {
    $('authLoading').hidden=true;feedbackRetry=null;
    currentUser = null; profile = null; tasks = []; agentProposals = []; members = []; feedback = []; workLogs=[];incidents=[];memberEmails={};
    thread.clear();if($('decision').open)$('decision').close('cancel');
    if($('quickFeedbackDialog').open)$('quickFeedbackDialog').close();
    feedbackVisibleCount=4;feedbackShowResolved=false;
    activePanel='tasks';
    nomination=null;feedbackGroups=[];cases=[];documents=[];documentRequest=null;caseRequest.clear();
    taskHistoryCache.clear();taskHistoryRequests.clear();
    $('documentList').replaceChildren();$('documentCreate').reset();
    $('incidentForm').reset();incidentLocation.reset();$('incidentId').value='';$('incidentsList').replaceChildren();
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
    // The textarea/date field is replaced during refresh. Restore keyboard focus
    // without scrolling the phone to the top of the newly rendered list.
    const focusSelector=anchor&&active?.matches?.('input,textarea,select')
      ?(active.matches('[data-due]')?'[data-due]':active.matches('[data-person]')?'[data-person]'
        :active.matches('textarea[data-body]')?'textarea[data-body]'
        :active.matches('[name="result"]')?'[name="result"]':null):null;
    const focusRange=focusSelector&&active.matches('textarea,input[type="text"],input[type="search"]')
      ?[active.selectionStart,active.selectionEnd]:null;
    return {
      focusSelector,focusRange,
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
    if(anchor&&state.focusSelector){
      const field=anchor.querySelector(state.focusSelector);
      if(field&&!field.disabled){
        field.focus({preventScroll:true});
        if(state.focusRange&&Number.isInteger(state.focusRange[0])&&Number.isInteger(state.focusRange[1]))
          field.setSelectionRange(...state.focusRange);
      }
    }
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
        ?'Koordinatorius atmetė registraciją. Jei tai klaida, kreipkitės info@giriuinspekcija.lt.'
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
      if(!approved()){$('workspace').hidden=true;thread.clear();}
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
      // Independent coordinator lists can load concurrently, not one after the other.
      const [inbox,people]=await Promise.all([
        staff()?client.from('gi_tasks')
          .select('id,source_ref,title,details,priority,due_at,created_at')
          .eq('status','proposed').like('source_ref','agent:%')
          .order('created_at',{ascending:false}).limit(30):Promise.resolve({data:[]}),
        staff()?(()=>{
          let query=client.from('gi_profiles')
            .select('id,display_name,role,registration_state,created_at,membership_intent,preferred_activity,region_label,volunteer_rank,can_prepare_documents')
            .order('created_at',{ascending:false}).limit(100);
          if(memberSearchTerm)query=query.ilike('display_name','%'+memberSearchTerm.replace(/[%_]/g,'')+'%');
          return query;
        })():Promise.resolve({data:[]})
      ]);
      if(inbox.error||people.error)throw inbox.error||people.error;
      agentProposals=inbox.data||[];
      members=people.data||[];
      if(staff()){
        const ids=members.map(p=>p.id);
        const lookup=ids.length?await client.rpc('gi_member_emails',{p_ids:ids}):{data:[]};
        if(lookup.error)throw lookup.error;
        memberEmails=Object.fromEntries((lookup.data||[]).map(x=>[x.user_id,x]));
      }else memberEmails={};
      const [feedbackResult,queue,reminder]=await Promise.all([
        client.from('gi_feedback').select('id,reporter_id,category,message,created_at').order('created_at',{ascending:false}).limit(60),
        staff()?client.from('gi_feedback_review').select('id,reports,task_id,resolved_at,resolution,gi_feedback!example_id(category,message)').order('last_report_at',{ascending:false}).limit(60):Promise.resolve({data:[]}),
        client.rpc('gi_deadline_counts')
      ]);
      if(feedbackResult.error||queue.error||reminder.error)throw feedbackResult.error||queue.error||reminder.error;
      feedback=feedbackResult.data||[];
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
      const logFields='id,task_id,volunteer_id,minutes,note,activity_title,review_status,review_note,created_at,work_date,project_label,general_activity,worker:gi_profiles!volunteer_id(display_name),job:gi_tasks!task_id(title)';
      // Fetch unrelated workspace datasets together. A slow view should not make
      // every other view wait for another network round-trip.
      const [totals,ownLogs,pendingLogs,ownTaskResult,incidentResult,reviewer,docs]=await Promise.all([
        client.rpc('gi_my_time_totals'),
        client.from('gi_work_logs').select(logFields)
          .eq('volunteer_id',currentUser.id).order('created_at',{ascending:false}).limit(70),
        staff()?client.rpc('gi_review_queue').select(logFields).order('created_at').order('id'):Promise.resolve({data:[]}),
        client.from('gi_tasks').select('id,title,status,updated_at')
          .eq('assigned_to',currentUser.id).order('updated_at',{ascending:false}).limit(25),
        client.from('gi_incidents').select('id,reporter_id,description,category,event_state,latitude,longitude,extra_points,status,created_at,observed_at')
          .order('created_at',{ascending:false}).limit(100),
        admin()?client.rpc('gi_reviewer_candidate'):Promise.resolve({data:null}),
        canWriteDocuments()?client.from('gi_documents').select('id,title,body,phase,revision,author_id,task_id,case_id')
          .order('updated_at',{ascending:false}).limit(50):Promise.resolve({data:[]})
      ]);
      for(const response of [totals,ownLogs,pendingLogs,ownTaskResult,incidentResult,reviewer,docs])
        if(response.error)throw response.error;
      timeTotals=totals.data?.[0]||{submitted:0,approved:0};
      workLogs=[...(ownLogs.data||[]),...(pendingLogs.data||[])];
      timeOwnTasks=ownTaskResult.data||[];
      incidents=incidentResult.data||[];
      nomination=reviewer.data;
      documents=docs.data||[];
      const ids=workLogs.filter(w=>w.review_status==='submitted').map(w=>w.id);
      const [permissions,caseResult]=await Promise.all([
        staff()&&ids.length?client.rpc('gi_reviewable_logs',{p_ids:ids}):Promise.resolve({data:[]}),
        staff()&&incidents.length?client.from('gi_cases').select('id,incident_id').in('incident_id',incidents.map(i=>i.id)):Promise.resolve({data:[]})
      ]);
      if(permissions.error||caseResult.error)throw permissions.error||caseResult.error;
      reviewableLogs=new Set(permissions.data||[]);
      cases=caseResult.data||[];
      $('manualTimeDate').max=window.giDeadlines.inputValue(new Date()).slice(0,10);
      if(!$('manualTimeDate').value)$('manualTimeDate').value=$('manualTimeDate').max;
      renderManualTimeTaskOptions();
      if(!$('incidentObserved').value)$('incidentObserved').value=window.giDeadlines.inputValue(new Date());
      if(currentUser?.id!==actor)return false;
      renderDocuments();
      renderNewTaskAssignees();
      renderIncidentDestination();
      renderAiProposals();
      renderTasks();
      renderWorkLogs();
      renderIncidents();
      renderPendingMembers();
      renderFeedback();
      $('workspace').hidden=false;
      restoreWorkspaceUi(uiState);thread.restore();
      return true;
    } catch(error) {
      if(currentUser?.id!==actor)return false;
      if(expiredSession(error)){endExpiredSession();return false;}
      notice('Nepavyko atnaujinti: ' + (error?.message || String(error)), true);
      return false;
    } finally {loading=false;finish();}
  }

  const panelTitles={tasks:'Darbai',time:'Valandos',incidents:'Įvykiai',documents:'Dokumentai',team:'Komanda',feedback:'Pastabos'};
  let feedbackOrigin='feedback', feedbackVisibleCount=4, feedbackShowResolved=false, feedbackQuickOrigin='tasks';
  function openPanel(name) {
    if(!['tasks','time','incidents','documents','team','feedback'].includes(name))name='tasks';
    if(name==='documents'&&!canWriteDocuments())name='tasks';
    if(name==='team'&&!staff())name='tasks';
    activePanel=name;
    $('quickFeedback').hidden=!approved();
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
  $('captureIncident').addEventListener('click',()=>{
    openPanel('incidents');$('incidentEditor').open=true;
    $('incidentDescription').focus({preventScroll:true});
    $('incidentForm').scrollIntoView({block:'nearest'});
  });
  function openQuickFeedback(){
    if(!approved()||!currentUser)return;
    feedbackQuickOrigin=$('threadDialog').open?'Kortelė':(panelTitles[activePanel]||'Programėlė');
    $('quickFeedbackContext').textContent='Pastaba apie: '+feedbackQuickOrigin;
    const dialog=$('quickFeedbackDialog');
    if(!dialog.open)dialog.showModal();
    // Prevent iOS Safari from jumping the viewport when its keyboard appears.
    dialog.scrollTop=0;
    $('quickFeedbackClose').focus({preventScroll:true});
  }
  $('quickFeedback').addEventListener('click',openQuickFeedback);
  $('threadQuickFeedback').addEventListener('click',openQuickFeedback);
  $('quickFeedbackClose').addEventListener('click',()=>$('quickFeedbackDialog').close());

  function updateNewTaskDestination(){
    const assigned=$('newTaskDestination').value==='assigned';
    $('newTaskAssigneeWrap').hidden=!assigned;
    $('newTaskAssignee').required=assigned;
  }
  function renderNewTaskAssignees(){
    const select=$('newTaskAssignee'),previous=select.value;
    const eligible=members.filter(m=>['volunteer','coordinator','admin'].includes(m.role)
      && memberEmails[m.id]?.verified===true);
    select.innerHTML='<option value="">Pasirinkite savanorį</option>'
      +eligible.map(m=>'<option value="'+escapeHTML(m.id)+'">'
        +escapeHTML(personName(m))+' ('+escapeHTML(memberEmails[m.id]?.email||'')+')</option>').join('');
    if(eligible.some(m=>m.id===previous))select.value=previous;
    updateNewTaskDestination();
  }
  $('newTaskDestination').addEventListener('change',updateNewTaskDestination);

  const clockDuration=minutes=>Math.floor(minutes/60)+' val. '+(minutes%60)+' min.';
  function renderManualTimeTaskOptions(){
    const select=$('manualTimeTask'),old=select.value;
    const term=$('manualTimeTaskSearch').value.trim().toLocaleLowerCase('lt-LT');
    const matching=timeOwnTasks.filter(t=>!term||String(t.title||'').toLocaleLowerCase('lt-LT').includes(term)||t.id===old);
    select.innerHTML='<option value="">Kita savanorystės veikla (be užduoties)</option>'
      +matching.map(t=>'<option value="'+escapeHTML(t.id)+'">'
        +escapeHTML(t.title)+' ('+escapeHTML(statusNames[t.status]||t.status)+')</option>').join('');
    if(matching.some(t=>t.id===old))select.value=old;
    $('manualTimeTaskHint').textContent=term?(matching.length?'Rasta užduočių: '+matching.length:'Nerasta. Pakeiskite paiešką.'):('Naujausios užduotys: '+timeOwnTasks.length+' (iki 25).');
    updateManualActivityMode();
  }
  function updateManualActivityMode(){
    const independent=!$('manualTimeTask').value;
    $('manualTimeActivityField').hidden=!independent;
    $('manualTimeActivity').required=independent;
    if(!independent)$('manualTimeActivity').value='';
  }
  $('manualTimeTask').addEventListener('change',updateManualActivityMode);
  $('manualTimeTaskSearch').addEventListener('input',renderManualTimeTaskOptions);
  function updateTimePresetButtons(){
    const total=Number($('manualTimeHours').value)*60+Number($('manualTimeMinutes').value);
    document.querySelectorAll('[data-time-preset]').forEach(button=>
      button.setAttribute('aria-pressed',String(Number(button.dataset.timePreset)===total)));
  }
  $('addHoursQuick').addEventListener('click',()=>{
    openPanel('time');
    const panel=$('timeEntryPanel');
    panel.open=true;
    panel.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
  $('manualTimeForm').addEventListener('click',event=>{
    const button=event.target.closest('[data-time-preset]');
    if(!button)return;
    const value=Number(button.dataset.timePreset);
    if(![15,30,60,90,120,180].includes(value))return;
    $('manualTimeHours').value=String(Math.floor(value/60));
    $('manualTimeMinutes').value=String(value%60);
    updateTimePresetButtons();
  });
  for(const id of ['manualTimeHours','manualTimeMinutes'])
    $(id).addEventListener('input',updateTimePresetButtons);
  // Reporting is local to the authorised staff member's browser. No writes or
  // third-party uploads; exact minutes retained to avoid rounding losses.
  function timeReportCsv(rows){
    const safe=v=>{
      let s=String(v??'');
      if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    };
    const header=['Data','Vykdytojas','Projektas','Veikla','Minutės','Valandos','Darbo aprašymas','Būsena','Įrašo ID'];
    const data=rows.map(w=>[
      w.work_date,w.worker?.display_name||'',w.general_activity?'Bendra savanorystė':(w.project_label||'Nepriskirta'),
      w.activity_title||w.job?.title||'',Number(w.minutes),
      (Number(w.minutes)/60).toFixed(4).replace('.',','),w.note||'','Patvirtinta',w.id
    ]);
    return '\uFEFF'+[header,...data].map(row=>row.map(safe).join(';')).join('\r\n')+'\r\n';
  }
  function timeReportMatches(w,scope,project){
    if(w.review_status!=='approved')return false;
    if(scope==='general')return w.general_activity===true;
    if(scope==='project')return w.general_activity===false&&!!w.project_label&&
      w.project_label.toLocaleLowerCase('lt').includes(project.toLocaleLowerCase('lt'));
    return scope==='all';
  }
  function renderWorkLogs(){

    const mine=workLogs.filter(w=>w.volunteer_id===currentUser?.id);
    $('myTimeSummary').textContent='Pateikta patvirtinti: '+clockDuration(Number(timeTotals.submitted))
      +' · Patvirtinta iš viso: '+clockDuration(Number(timeTotals.approved));
    const entry=w=>{
      const task=timeOwnTasks.find(t=>t.id===w.task_id)||tasks.find(t=>t.id===w.task_id);
      const owner=members.find(p=>p.id===w.volunteer_id);
      const title=w.activity_title||w.job?.title||task?.title||'Savanorystės veikla';
      return '<article class="log-card"><div class="log-head"><b>'+escapeHTML(title)+'</b><strong>'+escapeHTML(clockDuration(w.minutes))+'</strong></div>'
        +(w.volunteer_id!==currentUser?.id?'<p class="small">Vykdytojas: '+escapeHTML(w.worker?.display_name||(owner?personName(owner):'Savanoris'))+'</p>':'')
        +'<p class="small">'+escapeHTML(w.work_date||window.giDeadlines.inputValue(w.created_at).slice(0,10))
        +(w.project_label?' · '+escapeHTML(w.project_label):'')+'</p>'
        +'<p class="small">'
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
    $('reviewCount').textContent=others.length>50?'50+':String(others.length);
    $('staffTimePanel').hidden=!staff();
    if(staff()){
      const today=window.giDeadlines.inputValue(new Date()).slice(0,10);
      for(const id of ['timeReportFrom','timeReportTo'])$(id).max=today;
      if(!$('timeReportFrom').value)$('timeReportFrom').value=today.slice(0,7)+'-01';
      if(!$('timeReportTo').value)$('timeReportTo').value=today;
    }
    $('staffTimeLogs').innerHTML=others.length?others.slice(0,50).map(entry).join('')
      :'<p class="small">Nėra kitų savanorių valandų, laukiančių patvirtinimo.</p>';
  }
  function renderIncidents() {
    const expanded=new Set([...$('incidentsList').querySelectorAll('details[data-incident-id][open]')].map(el=>el.dataset.incidentId));
    $('incidentsList').innerHTML=incidents.length?incidents.map(v=>{
      const owner=members.find(m=>m.id===v.reporter_id);
      return '<details class="card incident-compact" data-incident-id="'+escapeHTML(v.id)+'"'+(expanded.has(v.id)?' open':'')+'><summary><b>'+escapeHTML(incidentCategoryLabel[v.category]||v.category)+'</b><span class="small">'+escapeHTML(v.status==='draft'?'Juodraštis':'Pateikta')+'</span><span class="incident-preview">'+escapeHTML(v.description||'')+'</span></summary>'
        +(staff()?'<p class="small">Pateikė: '+escapeHTML(owner?personName(owner):v.reporter_id===currentUser?.id?'Aš':'Naudotojas')+'</p>':'')
        +'<p>'+escapeHTML(v.description)+'</p>'
        +(v.latitude!==null&&v.longitude!==null?'<p class="small">Išsaugota vieta: '+escapeHTML(v.latitude)+'; '+escapeHTML(v.longitude)+(v.extra_points?.length?' · '+(1+v.extra_points.length)+' taškai':'')+'</p>':'')
        +(v.status==='submitted'?'<p>'+thread.link('incident',v.id,'Atverti kortelę ir istoriją')+'</p>':'')
        +(v.observed_at?'<p class="small">'+escapeHTML(window.giDeadlines.display(v.observed_at))+' (Vilniaus laiku)</p>':'')
        +'<button class="outline" type="button" data-photos="'+escapeHTML(v.id)+'">Nuotraukos</button><div data-gallery></div>'
        +caseActions(v)
        +(v.status==='draft'&&v.reporter_id===currentUser?.id
          ?'<button type="button" class="outline" data-edit-incident="'+escapeHTML(v.id)+'">Redaguoti juodraštį</button>':'')
        +'</details>';
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
    // The review list may update while the user is reading or editing a note.
    // Retain expanded rows and unsent task drafts across DOM replacement.
    const expandedQueue=new Set([...$('feedbackQueue').querySelectorAll('details[data-feedback-id][open]')]
      .map(el=>el.dataset.feedbackId));
    const expandedArchive=new Set([...$('feedbackList').querySelectorAll('details[data-feedback-report][open]')]
      .map(el=>el.dataset.feedbackReport));
    const feedbackDrafts=new Map([...$('feedbackQueue').querySelectorAll('form[data-feedback-create]')].map(form=>[
      form.dataset.feedbackCreate,{visible:!form.hidden,title:form.querySelector('[name="title"]')?.value||'',
        note:form.querySelector('[name="note"]')?.value||''}
    ]));
    const activeFeedback=document.activeElement?.closest?.('form[data-feedback-create]');
    const focusedDraft=activeFeedback?{id:activeFeedback.dataset.feedbackCreate,name:document.activeElement.name}:null;
    $('feedbackQueuePanel').hidden=!staff();
    const pending=feedbackGroups.filter(g=>!g.resolved_at);
    const groups=feedbackShowResolved?feedbackGroups:pending;
    $('feedbackQueueCount').textContent=pending.length?'('+pending.length+' naujos)':'(0 naujų)';
    $('feedbackResolvedToggle').textContent=feedbackShowResolved?'Slėpti išspręstas':'Rodyti išspręstas ('+(feedbackGroups.length-pending.length)+')';
    $('feedbackQueue').innerHTML=groups.map(g=>{
      const full=String(g.gi_feedback?.message||'');
      const preview=full.length>95?full.slice(0,95)+'…':full;
      return '<details class="feedback-item" data-feedback-id="'+escapeHTML(g.id)+'"><summary><b class="feedback-tag">'+escapeHTML(g.gi_feedback?.category||'Pastaba')+'</b>'
        +'<span class="feedback-snippet">'+escapeHTML(preview)+'</span>'
        +'<span class="small">×'+Number(g.reports||1)+'</span></summary>'
        +'<p>'+escapeHTML(full)+'</p>'
        +(g.resolved_at?'<p class="small">Sprendimas: '+escapeHTML(g.resolution||'Išspręsta')+'</p>':'<div class="actions">'
          +(g.task_id?'<span class="small">Užduotis '+escapeHTML(g.task_id.slice(0,8))+'</span>'
            :'<button type="button" class="outline" data-feedback-start="'+escapeHTML(g.id)+'">Sukurti užduotį</button>')
          +'<button type="button" class="outline" data-feedback-resolve="'+escapeHTML(g.id)+'">Užrašyti sprendimą</button></div>')
        +(!g.resolved_at&&!g.task_id?'<form class="feedback-create" data-feedback-create="'+escapeHTML(g.id)+'" hidden>'
          +'<label class="field">Užduoties pavadinimas<input name="title" required minlength="3" maxlength="140" placeholder="Ką konkrečiai pataisyti?"></label>'
          +'<label class="field">Ką reikės padaryti<textarea name="note" required minlength="5" maxlength="6000" rows="4" placeholder="Aiškus rezultatas ir patikros kriterijus"></textarea></label>'
          +'<button type="submit">Įkelti užduotį peržiūrai</button></form>':'')
        +'</details>';
    }).join('')||'<p class="small">Šiuo metu neišnagrinėtų pastabų nėra.</p>';
    $('feedbackTitle').textContent=(staff()?'Pastabų istorija':'Mano pastabos')+' ('+feedback.length+')';
    const shown=feedback.slice(0,feedbackVisibleCount);
    $('feedbackList').innerHTML=shown.length?shown.map(item=>{
      const who=members.find(m=>m.id===item.reporter_id);
      const message=String(item.message||'');
      const preview=message.length>105?message.slice(0,105)+'…':message;
      return '<details class="feedback-item" data-feedback-report="'+escapeHTML(item.id)+'"><summary><b class="feedback-tag">'+escapeHTML(item.category)+'</b>'
        +'<span class="feedback-snippet">'+escapeHTML(preview)+'</span>'
        +'<span class="small">'+escapeHTML(new Date(item.created_at).toLocaleDateString('lt-LT'))+'</span></summary>'
        +'<p>'+escapeHTML(message)+'</p>'
        +(staff()?'<p class="small">Pateikė: '+escapeHTML(who?personName(who):'Testuotojas')+'</p>':'')
        +'</details>';
    }).join(''):'<p class="small">Pastabų dar nėra.</p>';
    $('feedbackMore').hidden=feedback.length<=feedbackVisibleCount;
    $('feedbackMore').textContent='Rodyti daugiau ('+Math.max(0,feedback.length-feedbackVisibleCount)+')';
    $('feedbackQueue').querySelectorAll('details[data-feedback-id]').forEach(el=>{
      el.open=expandedQueue.has(el.dataset.feedbackId);
      const form=el.querySelector('form[data-feedback-create]');
      const draft=feedbackDrafts.get(el.dataset.feedbackId);
      if(form&&draft){
        form.hidden=!draft.visible;
        form.querySelector('[name="title"]').value=draft.title;
        form.querySelector('[name="note"]').value=draft.note;
      }
    });
    $('feedbackList').querySelectorAll('details[data-feedback-report]').forEach(el=>{
      el.open=expandedArchive.has(el.dataset.feedbackReport);
    });
    if(focusedDraft&&['title','note'].includes(focusedDraft.name)){
      const form=[...$('feedbackQueue').querySelectorAll('form[data-feedback-create]')]
        .find(el=>el.dataset.feedbackCreate===focusedDraft.id);
      form?.querySelector('[name="'+focusedDraft.name+'"]')?.focus({preventScroll:true});
    }
  }
  $('feedbackResolvedToggle').addEventListener('click',()=>{
    if(!staff())return;
    feedbackShowResolved=!feedbackShowResolved;
    renderFeedback();
  });
  $('feedbackMore').addEventListener('click',()=>{
    feedbackVisibleCount+=10;
    renderFeedback();
  });

  function assignmentActions(task,{inbox=false,secondary=false}={}){
    if(!staff()||!['proposed','pool','assigned'].includes(task.status))return '';
    const id=escapeHTML(task.id),key=(inbox?'inbox-':'')+id;
    const selectable=members.filter(m=>(['volunteer','coordinator','admin'].includes(m.role)
      ||(m.role==='candidate'&&task.candidate_safe))&&memberEmails[m.id]?.verified===true);
    const self=staff()&&Boolean(currentUser?.id)&&(memberEmails[currentUser.id]?.verified===true||Boolean(currentUser.email_confirmed_at));
    if(self&&!selectable.some(m=>m.id===currentUser.id))
      selectable.unshift({...profile,id:currentUser.id});
    return '<div class="task-assignment">'
      +(!secondary&&task.status==='proposed'&&self?'<button type="button" data-assign-self="'+id+'">Sau</button>':'')
      +(!secondary&&task.status==='pool'&&!task.assigned_to?'<button type="button" data-step="claim" data-id="'+id+'">Prisiimti sau</button>':'')
      +'<details class="assignment-picker" data-ui-key="assign-'+key+'"><summary aria-label="Priskirti savanoriui"><b>Priskirti</b></summary>'
      +'<div class="form-inline"><select aria-label="Pasirinkite vykdytoją" data-person="'+id+'">'
      +'<option value="">Pasirinkite žmogų</option>'
      +selectable.map(m=>'<option value="'+escapeHTML(m.id)+'"'+(task.assigned_to===m.id?' selected':'')+'>'
        +escapeHTML(personName(m))+(m.id===currentUser?.id?' (aš)':m.role==='candidate'?' (kandidatas)':'')+'</option>').join('')
      +'</select><button type="button" data-assign="'+id+'">Priskirti</button></div></details>'
      +(task.status==='proposed'?(inbox
        ?'<button class="outline" type="button" aria-label="Patvirtinti į fondą" data-ai-approve="'+id+'">Į fondą</button>'
        :'<button class="outline" type="button" aria-label="Skelbti fonde" data-step="publish" data-id="'+id+'">Į fondą</button>'):'')
      +'</div>';
  }
  async function handleStaffAssignment(button,task){
    if(!staff()||loading||mutationInFlight||!task||!['proposed','pool','assigned'].includes(task.status))return;
    const self=Boolean(button.dataset.assignSelf);
    const choice=self?currentUser?.id:button.closest('article')?.querySelector('[data-person]')?.value;
    const target=members.find(m=>m.id===choice)||(choice===currentUser?.id?profile:null);
    const verified=memberEmails[choice]?.verified===true||(choice===currentUser?.id&&Boolean(currentUser.email_confirmed_at));
    if(!target||!verified
      ||!(['volunteer','coordinator','admin'].includes(target.role)||(target.role==='candidate'&&task.candidate_safe)))
      return toast('Pasirinkite patvirtintą vykdytoją.',true);
    if(choice===task.assigned_to)return toast('Vykdytojas jau paskirtas.');
    if(!self&&!await ask('Priskirti užduotį žmogui „'+personName(target)+'“?'))return;
    const ok=await run(()=>client.rpc(task.status==='proposed'?'gi_assign_proposed_task':'gi_assign_task',
      {p_id:task.id,p_volunteer:choice}),self?'Užduotis priskirta jums.':'Užduotis priskirta: '+personName(target));
    if(ok&&self)showTaskToastLink(task.id);
  }
  function buttonsFor(task,{management=true,personal=true}={}){
    const id=escapeHTML(task.id);
    let markup='';
    const staffEditable=staff()&&['proposed','pool','assigned'].includes(task.status);
    if(staffEditable&&management){
      const safeButton=(!task.assigned_to&&['proposed','pool'].includes(task.status))
        ?'<details class="candidate-options" data-ui-key="candidate-'+id+'"><summary>Kandidato prieiga</summary>'
          +'<button class="outline" type="button" data-candidate-task="'+id+'">'
          +(task.candidate_safe?'Atšaukti kandidato galimybę':'Leisti užduotį kandidatui')
          +'</button></details>':'';
      markup+=(task.status==='assigned'&&task.assigned_to!==currentUser?.id?'<div class="actions"><button class="outline" type="button" data-step="unassign" data-id="'+id+'">Atšaukti paskyrimą</button></div>':'')+safeButton;
    }
    if(management&&staff() && ['proposed','pool','assigned','accepted','in_progress','returned'].includes(task.status)){
      markup+='<details data-ui-key="due-'+id+'"><summary>'+ (task.due_at?'Keisti terminą':'Nustatyti terminą') +'</summary>'
        +'<label class="field">Data ir laikas<input aria-label="Užduoties terminas" type="datetime-local" data-due="'+id+'"'
        +(task.due_at?' value="'+window.giDeadlines.inputValue(task.due_at)+'"':'')+'></label>'
        +'<div class="actions"><button type="button" data-set-due="'+id+'">Išsaugoti terminą</button>'
        +(task.due_at?'<button class="outline" type="button" data-clear-due="'+id+'">Pašalinti terminą</button>':'')
        +'</div></details>';
    }
    if(personal&&!staff() && !task.assigned_to && task.status==='pool' &&
      (profile?.role!=='candidate'||task.candidate_safe)){
      markup+='<div class="actions"><button type="button" data-step="claim" data-id="'+id+'">Pasiimti užduotį</button></div>';
    }
    if(personal&&task.assigned_to===currentUser?.id){
      if(task.status==='assigned')markup+='<div class="actions">'
        +'<button type="button" aria-label="Priimti užduotį" data-step="accept" data-id="'+id+'">Priimti</button></div>';
      if(['accepted','returned'].includes(task.status))markup+='<div class="actions">'
        +'<button type="button" data-step="start" data-id="'+id+'">Pradėti / tęsti</button></div>';
      if(task.status==='in_progress')markup+='<form data-submit-result="'+id+'">'
        +'<label class="field">Atlikto darbo rezultatas<textarea name="result" required minlength="10" maxlength="6000" placeholder="Kas atlikta?"></textarea></label>'
        +'<button type="submit">Pateikti rezultatą</button></form>';
    }
    if(management&&task.assigned_to===currentUser?.id&&task.status==='assigned')
      markup+='<div class="actions"><button type="button" class="outline" data-step="decline" data-id="'+id+'">Atsisakyti užduoties</button></div>';
    if(personal&&staff()&&task.status==='submitted'&&task.assigned_to!==currentUser?.id){
      markup+='<p class="small">Galite kartu patvirtinti jums leidžiamus laiko įrašus arba atskirai peržiūrėti valandas.</p>'
        +'<div class="actions"><button type="button" data-joint-approve="'+id+'">'
        +'Patvirtinti rezultatą ir laiką</button>'
        +'<button type="button" class="outline" data-step="approve" data-id="'+id+'">Patvirtinti tik rezultatą</button>'
        +'<button type="button" class="outline" data-step="return" data-id="'+id+'">Grąžinti taisyti</button></div>';
    }
    if(personal&&staff()&&task.status==='submitted'&&task.assigned_to===currentUser?.id)
      markup+='<p class="small">Jūsų rezultatą turi patvirtinti kitas koordinatorius.</p>';
    return markup;
  }
  function timeEntry(task){
    if(task.assigned_to!==currentUser?.id ||
       !['assigned','accepted','in_progress','submitted','returned','approved'].includes(task.status))return '';
    return '<div class="actions"><button type="button" class="outline" aria-label="Pridėti darbo laiką" data-time-for-task="'+escapeHTML(task.id)+'">'
      +'Laikas</button></div>';
  }
  // ChatGPT suggestions remain proposed until staff explicitly publishes them.
  // Escaping is mandatory: proposal bodies originate outside the application.
  function taskDescription(task,prefix='description-'){
    const full=String(task.details||'');
    if(full.length<=110)return '<p class="task-description">'+escapeHTML(full)+'</p>';
    return '<details class="task-description-toggle" data-ui-key="'+prefix+escapeHTML(task.id)+'"><summary aria-label="Rodyti visą aprašymą arba suskleisti">'
      +'<span class="description-preview">'+escapeHTML(full.slice(0,105))+'…</span>'
      +'<span class="description-full">'+escapeHTML(full)+'</span></summary></details>';
  }
  function renderAiProposals(){
    if(!staff())return;
    const list=$('aiProposalList');
    $('aiProposalCount').textContent=agentProposals.length
      ?agentProposals.length+(agentProposals.length===30?' pirmųjų':' laukia'):'0 laukia';
    list.innerHTML=agentProposals.length
      ?agentProposals.map(t=>{
        const importance=t.priority==='high'?'Svarbi':t.priority==='low'?'Mažesnė':'Įprasta';
        const due=t.due_at?'<p class="small"><b>Terminas:</b> '
          +escapeHTML(window.giDeadlines.display(t.due_at)+' (Vilniaus laiku)')+'</p>':'';
        const source=String(t.source_ref||'');
        const gmail=/^agent:gmail\/([0-9a-f]{16})$/.exec(source);
        const sourceLink=gmail
          ?'<p class="small"><a href="https://mail.google.com/mail/u/?authuser=giriuinspekcija%40gmail.com#all/'
            +encodeURIComponent(gmail[1])+'" target="_blank" rel="noopener noreferrer">Atidaryti šaltinio laišką (tik su GI Gmail prieiga)</a></p>'
          :'';
        return '<article class="task" data-ai-task="'+escapeHTML(t.id)+'">'
          +'<div class="row"><span class="tag proposed">'+(gmail?'Iš GI Gmail':'ChatGPT pasiūlymas')+'</span>'
          +'<span class="small">'+escapeHTML(importance)+'</span></div>'
          +'<h3>'+escapeHTML(t.title)+'</h3>'
          +taskDescription(t,'ai-description-')+sourceLink+due
          +assignmentActions({...t,status:'proposed'},{inbox:true})+'</article>';
      }).join('')
      :'<p class="small">Kol kas nėra naujų ChatGPT pasiūlymų. Paprašykite ChatGPT pateikti užduotis GI komandai ir atnaujinkite šį sąrašą.</p>';
  }
  function renderTasks(){
    const list=$('taskList');
    const currentView=taskFilter==='pool'&&!ownerFilter&&!searchText&&dueFilter==='all'?'pool'
      :taskFilter==='all'&&ownerFilter==='mine'&&!searchText&&dueFilter==='all'?'mine'
      :taskFilter==='all'&&!ownerFilter&&!searchText&&dueFilter==='all'?'all':null;
    $('taskQuickViews').querySelectorAll('[data-task-view]').forEach(button=>
      button.setAttribute('aria-pressed',String(button.dataset.taskView===currentView)));
    const mine=tasks.filter(t=>t.assigned_to===currentUser?.id);
    const pool=tasks.filter(t=>t.status==='pool'&&!t.assigned_to).length;
    const active=mine.filter(t=>['assigned','accepted','in_progress','returned'].includes(t.status)).length;
    const submitted=staff()?tasks.filter(t=>t.status==='submitted').length
      :mine.filter(t=>t.status==='submitted').length;
    $('taskSummary').innerHTML='<span><b>Rodomų:</b> '+tasks.length+'</span>'
      +'<span><b>Mano aktyvios:</b> '+active+'</span>'
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
      const compactDescription=taskDescription(t);
      const controls=buttonsFor(t,{management:false})+timeEntry(t);
      const management=buttonsFor(t,{personal:false});
      const assigned=t.status==='assigned';
      const secondaryAssignment=assigned?assignmentActions(t,{secondary:true}):'';
      const created=t.created_at?'<p class="task-created small">Sukurta: '+escapeHTML(window.giDeadlines.display(t.created_at))+'</p>':'';
      return '<article class="task" data-task="'+escapeHTML(t.id)+'">'
        +'<div class="row"><span class="tag '+escapeHTML(t.status)+'">'
          +escapeHTML(statusNames[t.status]||t.status)+'</span>'
        +'<span class="small">'+escapeHTML(t.priority==='high'?'Svarbu':t.priority==='low'?'Maža svarba':'Įprasta')+'</span></div>'
        +'<h3>'+thread.link('task',t.id,t.title)+'</h3>'+created+compactDescription+due
        +(t.assigned_to===currentUser?.id?'<p class="small task-owner"><b>Paskirta man</b></p>'
          :staff()?'<p class="small task-owner">Vykdytojas: '+escapeHTML(owner?personName(owner):t.assigned_to?'Priskirtas savanoris':'Nepaskirta')+'</p>':'')
        +(t.candidate_safe?'<p class="small">Kandidatui suteikta prieiga</p>':'')
        +(t.feedback_text?'<p class="alert">Koordinatoriaus pastaba: '+escapeHTML(t.feedback_text)+'</p>':'')
        +(t.result_text?'<p class="small"><b>Rezultatas:</b> '+escapeHTML(t.result_text)+'</p>':'')
        +(t.case_id?'<p class="small">Atvejis '+escapeHTML(t.case_id.slice(0,8))+'</p>':'')
        +'<div class="task-toolbar">'
        +(!assigned?assignmentActions(t):'')
        +(controls?'<div class="task-primary-actions">'+controls+'</div>':'')
        +'<details class="task-actions-more task-overflow" data-ui-key="manage-'+escapeHTML(t.id)+'"><summary aria-label="Kiti veiksmai ir istorija" title="Kiti veiksmai ir istorija">⋯</summary><div class="task-overflow-content">'
        +secondaryAssignment+management
        +'<details class="task-actions-more" data-ui-key="history-'+escapeHTML(t.id)+'">'
        +'<summary>Veiksmų istorija</summary>'
        +'<button type="button" class="ghost" data-load-history="'+escapeHTML(t.id)+'">Bandyti dar kartą / atnaujinti</button>'
        +'<div data-task-history="'+escapeHTML(t.id)+'" class="small">'
        +(taskHistoryCache.has(t.id)?taskHistoryCache.get(t.id):'Atverkite istoriją, jei reikia matyti ankstesnius veiksmus.')
        +'</div></details></div></details></div></article>';
    }).join('');
  }
  // Prevent duplicate taps and show a persistent, local confirmation even when
  // the updated button disappears after a status transition.
  async function run(call,successMessage='Veiksmas išsaugotas.') {
    if(mutationInFlight)return false;
    if(navigator.onLine===false){toast('Nėra interneto ryšio. Bandykite prisijungę.',true);return false;}
    mutationInFlight=true;
    const button=lastControl?.isConnected?lastControl:document.activeElement?.closest('button');
    const clearBusy=busy(button,button?.closest('#incidentForm')?(button.value==='submit'?'Pateikiama…':'Saugomas juodraštis…'):'Saugoma…');
    toast('Išsaugoma…');
    try {
      notice('');
      const result=await call();
      if(result?.error)throw result.error;
      // The server already confirmed the write. A later UI refresh failure must
      // never be reported as a failed write (which invites accidental retries).
      taskHistoryCache.clear();
      const msg=typeof successMessage==='function'?successMessage(result?.data):successMessage;
      let refreshed=false;
      try{
        if(loading)await refreshFinished;
        refreshed=await refreshWorkspace();
      }catch(refreshError){
        if(expiredSession(refreshError))endExpiredSession();
      }
      if(!refreshed){
        toast(msg);
        notice('Veiksmas išsaugotas serveryje, bet ekranas neatsinaujino. Spauskite „Atnaujinti“; to paties veiksmo nekartokite.',true);
        return true;
      }
      toast(msg);
      return true;
    } catch(error) {
      if(expiredSession(error)){endExpiredSession();return false;}
      const message='Nepavyko atlikti veiksmo: '+(error?.message||'Nežinoma klaida');
      toast(message,true);
      return false;
    } finally {
      clearBusy();
      mutationInFlight=false;
    }
  }
  function onSignIn(){
    if(signInFlight)return signInFlight;
    signInFlight=loadSignedIn().finally(()=>{signInFlight=null;$('authLoading').hidden=true;});
    return signInFlight;
  }
  async function loadSignedIn() {
    if(!client){notice('Nepavyko įkelti prisijungimo bibliotekos. Patikrinkite ryšį.',true);return;}
    const {data,error}=await client.auth.getUser();
    if(passwordRecovery)return;
    if(error || !data.user){await googleProviderReady;if(!passwordRecovery)showLoggedOut();return;}
    if(loading)await refreshFinished;
    currentUser=data.user;thread.afterLogin();
    updateAccountSwitcher();
    clearSignupWaiting();
    showSignupWaiting();
    // Email-link registrations have no password until verified; Google OAuth does not require one.
    const providers = data.user.app_metadata?.providers || [];
    const googleLogin = providers.includes('google');
    const check=await client.rpc('gi_password_needed');
    if(passwordRecovery||currentUser?.id!==data.user.id)return;
    $('authLoading').hidden=true;
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
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);
    try {
      const res=await fetch(URL+'/auth/v1/settings',{headers:{apikey:KEY},cache:'no-store',signal:controller.signal});
      if(!res.ok)return;
      const settings=await res.json();
      const enabled=settings?.external?.google===true;
      $('googleLoginPanel').hidden=!enabled;
      $('googleSeparator').hidden=!enabled;
    }catch {}finally{clearTimeout(timeout);}
  }
  $('googleLogin').addEventListener('click',async()=>{
    const button=$('googleLogin');
    button.disabled=true;
    try{
      if(!client)throw new Error('Prisijungimas nepasiekiamas.');
      thread.rememberRoute();
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
  const googleProviderReady=refreshGoogleProvider();
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
    $('authLoading').hidden=true;
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
  $('refresh').addEventListener('click',async()=>{
    if(loading)return;
    const done=busy($('refresh'),'…');
    try{await refreshWorkspace();}finally{done();}
  });
  $('dueReminderButtons').addEventListener('click',e=>{
    const button=e.target.closest('[data-when]');
    if(!button||loading)return;
    $('taskStatusFilter').value='assigned';$('taskSearch').value='';$('taskDueFilter').value=button.dataset.when;
    $('taskOwnerFilter').value='mine';$('taskSearchForm').requestSubmit();
  });
  $('feedbackQueue').addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b||!staff()||mutationInFlight)return;
    if(b.dataset.feedbackStart){
      const form=b.closest('details')?.querySelector('[data-feedback-create]');
      if(!form)return;
      form.hidden=!form.hidden;
      if(!form.hidden)form.querySelector('input[name="title"]').focus({preventScroll:true});
      return;
    }
    if(!b.dataset.feedbackResolve)return;
    const note=await ask('Koks šios pastabos sprendimas?',{input:true,action:'Išsaugoti sprendimą'});
    if(!note||note.trim().length<3)return;
    return run(()=>client.rpc('gi_review_feedback_group',{
      p_id:b.dataset.feedbackResolve,p_action:'resolve',p_title:null,p_note:note.trim(),p_priority:'normal'
    }),'Sprendimas išsaugotas.');
  });
  $('feedbackQueue').addEventListener('submit',event=>{
    const form=event.target.closest('[data-feedback-create]');
    if(!form||!staff())return;
    event.preventDefault();
    if(mutationInFlight)return;
    const data=new FormData(form),title=String(data.get('title')||'').trim();
    const note=String(data.get('note')||'').trim();
    if(title.length<3||title.length>140||note.length<5||note.length>6000)
      return toast('Įveskite pavadinimą ir aiškų aprašymą.',true);
    return run(()=>client.rpc('gi_review_feedback_group',{
      p_id:form.dataset.feedbackCreate,p_action:'task',p_title:title,p_note:note,p_priority:'normal'
    }),'Sukurta užduotis koordinatoriaus peržiūrai.');
  });
  $('taskQuickViews').addEventListener('click',event=>{
    const button=event.target.closest('[data-task-view]');
    if(!button||!approved()||loading)return;
    const view=button.dataset.taskView;
    if(!['mine','pool','all'].includes(view))return;
    taskFilter=view==='pool'?'pool':'all';
    ownerFilter=view==='mine'?'mine':'';
    searchText='';dueFilter='all';taskCursor=null;tasks=[];
    $('taskSearchForm').reset();
    $('taskStatusFilter').value=taskFilter;
    $('taskOwnerFilter').value=ownerFilter;
    refreshWorkspace();
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
    if(!await ask('Atšaukti registracijos prašymą? Prieiga nebus suteikta. Paskyros duomenys nebus automatiškai ištrinti.'))return;
    await run(()=>client.rpc('gi_review_registration',{p_user:currentUser.id,p_action:'withdraw'}));
  });
  $('pendingRefresh').addEventListener('click',async()=>{
    await refreshWorkspace();
    if(profile?.role==='pending')notice('Būsena nepasikeitė: laukiate koordinatoriaus patvirtinimo.');
    else if(profile)notice('Jūsų būsena: '+(roleNames[profile.role]||profile.role)+'.');
  });
  $('activateMaster').addEventListener('click',async()=>{
    if(!client||!currentUser||profile?.role!=='pending')return;
    if(!await ask('Aktyvuoti šios patvirtintos paskyros pagrindinio administratoriaus teises?'))return;
    await run(()=>client.rpc('gi_claim_first_admin'));
  });

  $('proposalForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(!staff())return;
    const form=event.currentTarget,fd=new FormData(form);
    const destination=String(fd.get('destination')||'pool');
    const assignee=String(fd.get('assignee')||'');
    if(!['pool','assigned','proposed'].includes(destination))
      return toast('Pasirinkite, kur dėti užduotį.',true);
    const chosen=members.find(m=>m.id===assignee);
    if(destination==='assigned' && (!chosen
       || !['volunteer','coordinator','admin'].includes(chosen.role)
       || memberEmails[assignee]?.verified!==true)){
      $('newTaskAssignee').focus();
      return toast('Pasirinkite patvirtintą savanorį.',true);
    }
    run(async()=>{
      const deadline=String(fd.get('due')||'');
      if(!proposalRef)proposalRef=crypto.randomUUID();
      const result=await client.rpc('gi_submit_task',{
        p_due:deadline?window.giDeadlines.toInstant(deadline):null,
        p_title:String(fd.get('title')||''),p_details:String(fd.get('details')||''),
        p_priority:String(fd.get('priority')||'normal'),
        p_source_ref:'web-'+proposalRef
      });
      if(result.error)return result;
      const id=result.data;
      if(destination!=='proposed'){
        // Existing RPCs are idempotently resumed on retry if a later step fails.
        // Keep the local source ref and form draft until ALL steps are confirmed.
        const lookup=await client.from('gi_tasks').select('status,assigned_to').eq('id',id).maybeSingle();
        if(lookup.error)return lookup;
        if(!lookup.data)return {error:Error('Užduotis sukurta, bet jos būsenos patikrinti nepavyko. Atnaujinkite sąrašą.')};
        let status=lookup.data.status;
        if(status==='proposed'){
          const published=await client.rpc('gi_task_action',{p_id:id,p_action:'publish',p_note:null});
          if(published.error)return {error:Error('Užduotis sukurta, bet nepaskelbta: '+published.error.message+'. Galima bandyti dar kartą.')};
          status='pool';
        }
        if(destination==='pool' && status!=='pool')
          return {error:Error('Užduotis jau turi kitą būseną. Atnaujinkite sąrašą.')};
        if(destination==='assigned' && !(status==='assigned' && lookup.data.assigned_to===assignee)){
          if(status!=='pool')return {error:Error('Užduotis jau paskirta arba pakeista. Atnaujinkite sąrašą.')};
          const assigned=await client.rpc('gi_assign_task',{p_id:id,p_volunteer:assignee});
          if(assigned.error)return {error:Error('Užduotis sukurta fonde, bet nepavyko priskirti: '+assigned.error.message+'. Galite bandyti dar kartą.')};
        }
      }
      form.reset();proposalRef=null;updateNewTaskDestination();
      return result;
    },destination==='assigned'?'Užduotis sukurta ir paskirta savanoriui.'
      :destination==='pool'?'Užduotis paskelbta bendrame fonde.'
      :'Užduoties pasiūlymas išsaugotas.');
  });
  async function submitFeedback(form,origin,button){
    if(!currentUser||!approved()||feedbackSending)return;
    const data=new FormData(form),raw=String(data.get('message')||'').trim();
    if(raw.length<5)return toast('Aprašykite problemą bent 5 simboliais.',true);
    const message=origin?'['+origin+'] '+raw:raw;
    if(message.length>1500)return toast('Pastaba per ilga – sutrumpinkite tekstą.',true);
    const owner=currentUser.id,category=String(data.get('category')||'pasiulymas');
    const signature=JSON.stringify([owner,category,message]);
    if(feedbackRetry?.signature!==signature)feedbackRetry={signature,id:crypto.randomUUID()};
    const id=feedbackRetry.id;
    feedbackSending=true;
    const restore=busy(button,'Siunčiama…');
    const controls=[...form.querySelectorAll('input,select,textarea')].filter(el=>!el.disabled);
    controls.forEach(el=>el.disabled=true);
    toast('Pastaba siunčiama…');
    try{
      const result=await client.from('gi_feedback').insert({id,reporter_id:owner,category,message});
      if(result.error){
        // If the server committed but the response was lost, retry the same UUID.
        if(result.error.code!=='23505')throw result.error;
        const prior=await client.from('gi_feedback').select('id,reporter_id,category,message').eq('id',id).eq('reporter_id',owner).maybeSingle();
        if(prior.error||prior.data?.id!==id||prior.data.category!==category||prior.data.message!==message)throw result.error;
      }
      if(currentUser?.id!==owner)return;
      feedbackRetry=null;
      form.reset();
      if($('quickFeedbackDialog').open)$('quickFeedbackDialog').close();
      feedbackOrigin='feedback';
      toast('Pastaba išsiųsta. Ačiū, kad padedate tobulinti programėlę!');
      if(activePanel==='feedback'&&!mutationInFlight)await refreshWorkspace();
    }catch(error){
      if(currentUser?.id===owner)toast('Nepavyko išsiųsti pastabos: '+(error?.message||'Patikrinkite ryšį.')+' Tekstas išsaugotas formoje.',true);
    }finally{controls.forEach(el=>el.disabled=false);restore();feedbackSending=false;}
  }
  $('feedbackForm').addEventListener('submit',event=>{
    event.preventDefault();
    submitFeedback(event.currentTarget,
      feedbackOrigin==='feedback'?'':(panelTitles[feedbackOrigin]||''),
      event.submitter||event.currentTarget.querySelector('button[type=submit]'));
  });
  $('quickFeedbackForm').addEventListener('submit',event=>{
    event.preventDefault();
    submitFeedback(event.currentTarget,feedbackQuickOrigin,
      $('quickFeedbackSend'));
  });
  $('aiRefresh').addEventListener('click',async()=>{
    if(!staff()||loading)return;
    const restore=busy($('aiRefresh'),'Tikrinama…');
    try{if(await refreshWorkspace())toast('ChatGPT pasiūlymų sąrašas atnaujintas.');}
    finally{restore();}
  });
  $('aiProposalList').addEventListener('click',async event=>{
    const button=event.target.closest('[data-ai-approve],[data-assign],[data-assign-self]');
    if(!button||!staff()||loading||mutationInFlight)return;
    const id=button.dataset.aiApprove||button.dataset.assign||button.dataset.assignSelf;
    const task=agentProposals.find(t=>t.id===id);
    if(!task)return;
    if(button.dataset.assign||button.dataset.assignSelf)return handleStaffAssignment(button,{...task,status:'proposed'});
    // The button already states the action; avoid a redundant confirmation.
    await run(()=>client.rpc('gi_task_action',{p_id:task.id,p_action:'publish',p_note:null}),
      'ChatGPT pasiūlymas patvirtintas ir perkeltas į užduočių fondą.');
  });
  // ChatGPT-generated proposals must be reviewed by a coordinator; never assign automatically.
  let reviewedBatch = null;
  async function parseBatchInput() {
    const input=$('batchJson').value.trim().replace(/^```(?:json)?\s*|\s*```$/gi,'').trim();
    if(!input)throw Error('Pirmiausia įklijuokite bent vieną užduotį.');
    let raw;
    if(/^[{[]/.test(input)){
      try{raw=JSON.parse(input);}catch{throw Error('JSON nepavyko perskaityti. Taip pat galite įklijuoti po vieną užduotį eilutėje.');}
    }else{
      const lines=input.split(/\r?\n/).map(line=>line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '')).filter(Boolean);
      if(lines.length>20)throw Error('Vienu kartu galima įkelti iki 20 užduočių.');
      raw=await Promise.all(lines.map(async line=>{
        const parts=line.split(/\s+[–—-]\s+/),title=parts.shift().trim(),details=parts.join(' – ').trim()||title;
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(line.normalize('NFC')));
        const key=Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
        return {title,details,priority:'normal',source_ref:'paste:'+key};
      }));
    }
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
        throw Error('Patikrinkite '+(index+1)+' eilutę. Pavadinimui reikia 3–140 ženklų, aprašymui 5–6000.');
      }
      return {title,details,priority,source_ref};
    });
  }
  $('batchJson').addEventListener('input',()=>{
    reviewedBatch=null;$('batchImport').disabled=true;$('batchReview').textContent='';
  });
  $('batchPreview').addEventListener('click',async()=>{
    if(!staff())return;
    try {
      const before=$('batchJson').value,arr=await parseBatchInput();
      if(before!==$('batchJson').value)return;
      const refs=arr.map(t=>t.source_ref);
      if(new Set(refs).size!==refs.length) throw Error('Ta pati užduotis sąraše kartojasi. Pašalinkite pasikartojančią eilutę.');
      reviewedBatch=arr;
      $('batchReview').innerHTML='<b>Paruošta peržiūrai: '+arr.length+' užduočių.</b><ol>'
        +arr.map(t=>'<li><b>'+escapeHTML(t.title)+'</b> – '+escapeHTML({high:'Svarbi',normal:'Įprasta',low:'Mažesnė'}[t.priority])
          +'<p class="small">'+escapeHTML(t.details.slice(0,200))+'</p></li>').join('')+'</ol>';
      $('batchImport').disabled=false;
    } catch(error) {
      reviewedBatch=null; $('batchImport').disabled=true; $('batchReview').textContent=error.message;
    }
  });
  $('batchImport').addEventListener('click',async()=>{
    if(!staff()||!reviewedBatch?.length)return;
    const copy=reviewedBatch;
    const restore=busy($('batchImport'),'Įkeliama…');
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
    restore();$('batchImport').disabled=true;
    reviewedBatch=null;
    if(!failures.length){$('batchJson').value='';$('batchReview').textContent='';}
    else $('batchReview').textContent='Klaidos: '+failures.slice(0,5).join(' | ');
    await refreshWorkspace();
    notice('Patvirtintų siūlomų užduočių: '+imported+' iš '+copy.length
      +(failures.length?'. Dalis klaidų – žr. importo lauką.':'. Užduotys jau yra fonde.'),!!failures.length);
  });
  $('pendingMembers').addEventListener('click',async event=>{
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
      if(id!==nomination || !await ask('Ar patikrinote asmens tapatybę? Suteikti '+email+' savanorių laiko tvirtinimo teisę?'))return;
      return run(()=>client.rpc('gi_appoint_reviewer',{p_user:id}),'Valandų tvirtinimo teisė suteikta.');
    }
    if(btn.dataset.purgeInvalid){
      if(!admin()||person?.role!=='pending'||memberEmails[id]?.verified!==false
        ||!['rejected','withdrawn'].includes(person.registration_state))return;
      const typed=await ask('Negrįžtamai pašalinti nepatvirtintą registraciją. Patvirtinkite įvesdami tikslų el. paštą: '+email,{input:true});
      if(typed===null)return;
      if(typed.trim().toLowerCase()!==email.toLowerCase()){
        toast('Adresas nesutampa. Nieko nepašalinta.',true);return;
      }
      return run(()=>client.rpc('gi_purge_invalid_signup',{p_user:id,p_expected_email:email}),
        'Klaidinga nepatvirtinta registracija išvalyta.');
    }
    if(btn.dataset.rejectRegistration){
      if(!person||person.role!=='pending')return;
      if(!await ask('Atmesti '+personName(person)+' registracijos prašymą? Tai neatlieka fizinio paskyros ištrynimo.'))return;
      return run(()=>client.rpc('gi_review_registration',{p_user:id,p_action:'reject'}),
        'Registracija atmesta: '+email);
    }
    if(btn.dataset.restoreRegistration){
      if(!person||person.role!=='pending')return;
      if(!await ask('Atkurti '+personName(person)+' registracijos prašymą peržiūrai?'))return;
      return run(()=>client.rpc('gi_review_registration',{p_user:id,p_action:'restore'}),
        'Registracija grąžinta peržiūrai: '+email);
    }
    if(btn.dataset.approveCandidate) {
      if(!await ask('Patvirtinti šį žmogų kandidatu? Jis matys tik specialiai leistas užduotis.'))return;
      return run(()=>client.rpc('gi_approve_candidate',{p_user:id}),
        'Kandidatas priimtas: '+email);
    }
    if(btn.dataset.approveVolunteer){
      if(!await ask('Patvirtinti, kad šis žmogus yra GI savanoris?'))return;
      return run(()=>client.rpc('gi_approve_volunteer',{p_user:id}),
        'Savanoris patvirtintas: '+email);
    }
    if(btn.dataset.promoteCandidate){
      if(!await ask('Po darbo peržiūros pakelti kandidatą į patvirtintą savanorį?'))return;
      return run(()=>client.rpc('gi_promote_candidate',{p_user:id}),
        'Kandidatas patvirtintas savanoriu: '+email);
    }
    if(!admin())return;
    if(btn.dataset.changeRole){
      const role=[...document.querySelectorAll('[data-role-select]')].find(e=>e.dataset.roleSelect===id)?.value;
      if(!['pending','candidate','volunteer','coordinator'].includes(role))return;
      if(!await ask('Pakeisti šio nario vaidmenį į „'+roleNames[role]+'“?'))return;
      if(role===person?.role)return toast('Jokių pakeitimų: jau pasirinktas vaidmuo „'+roleNames[role]+'“.');
      return run(()=>client.rpc('gi_set_user_role',{p_user:id,p_role:role}),
        'Vaidmuo pakeistas į „'+roleNames[role]+'“: '+email);
    }
    if(btn.dataset.rankChange){
      const rank=[...document.querySelectorAll('[data-rank-select]')].find(e=>e.dataset.rankSelect===id)?.value;
      if(!['pradedantysis','patyres','vyriausias','regiono_vadas'].includes(rank))return;
      if(!await ask('Patvirtinti savanorio patirties laipsnį?'))return;
      return run(()=>client.rpc('gi_set_volunteer_rank',{p_user:id,p_rank:rank}));
    }
    if(btn.dataset.docPermission){
      const person=members.find(m=>m.id===id);
      if(!person||person.role!=='volunteer')return;
      const allowed=!person.can_prepare_documents;
      if(!await ask((allowed?'Leisti':'Atšaukti')+' šio savanorio raštų projektų rengimo teisę? DI dar neprijungta.'))return;
      return run(()=>client.rpc('gi_set_document_permission',{p_user:id,p_allowed:allowed}));
    }
  });
  async function loadTaskHistory(id,box,button,{force=false}={}){
    if(!box||!tasks.some(t=>t.id===id))return;
    if(!force && taskHistoryCache.has(id)){
      box.innerHTML=taskHistoryCache.get(id);return;
    }
    if(taskHistoryRequests.has(id))return;
    taskHistoryRequests.add(id);
    if(button)button.disabled=true;
    box.textContent='Įkeliama veiksmų istorija…';
    try{
      const {data,error}=await client.from('gi_task_events')
        .select('action,note,created_at').eq('task_id',id)
        .order('created_at',{ascending:false}).limit(40);
      if(error)throw error;
      const html=(data||[]).length?(data||[]).map(row=>
        '<p><b>'+escapeHTML(taskEventLabels[row.action]||row.action)+'</b> · '
        +escapeHTML(window.giDeadlines.display(row.created_at))
        +(row.note?'<span> – '+escapeHTML(row.note)+'</span>':'')+'</p>'
      ).join(''):'<p>Šiai užduočiai įvykių dar neužfiksuota.</p>';
      taskHistoryCache.set(id,html);
      if(box.isConnected)box.innerHTML=html;
    }catch(error){
      if(box.isConnected)box.textContent='Istorijos nepavyko įkelti. Spauskite „Bandyti dar kartą“.';
      toast('Istorijos įkėlimas nepavyko: '+(error?.message||'patikrinkite ryšį'),true);
    }finally{
      taskHistoryRequests.delete(id);
      if(button&&button.isConnected)button.disabled=false;
    }
  }
  // Opening a history section must load events immediately. No second tap.
  // Native toggle does not bubble, therefore the listener uses capture=true.
  $('taskList').addEventListener('toggle',event=>{
    const details=event.target;
    if(!details.matches?.('details.task-actions-more[data-ui-key^="history-"]')||!details.open)return;
    const id=details.closest('[data-task]')?.dataset.task;
    if(id)void loadTaskHistory(id,details.querySelector('[data-task-history]'),
      details.querySelector('[data-load-history]'));
  },true);
  $('taskList').addEventListener('click',async event=>{
    const b=event.target.closest('button');
    if(!b||mutationInFlight)return;
    if(b.dataset.loadHistory){
      const box=b.closest('details')?.querySelector('[data-task-history]');
      await loadTaskHistory(b.dataset.loadHistory,box,b,{force:true});
      return;
    }
    const id=b.dataset.id || b.dataset.assign || b.dataset.assignSelf || b.dataset.candidateTask
      || b.dataset.jointApprove || b.dataset.timeForTask;
    if(b.dataset.timeForTask){
      const task=tasks.find(t=>t.id===id);
      if(task && task.assigned_to===currentUser?.id){
        const select=$('manualTimeTask');
        $('manualTimeTaskSearch').value='';renderManualTimeTaskOptions();
        if(![...select.options].some(o=>o.value===id)){
          const extra=document.createElement('option');extra.value=id;extra.textContent=task.title;
          select.add(extra);
        }
        select.value=id;updateManualActivityMode();openPanel('time');$('timeEntryPanel').open=true;
        $('manualTimeForm').scrollIntoView({behavior:'smooth',block:'start'});
      }
      return;
    }
    if(b.dataset.jointApprove && staff()){
      const task=tasks.find(t=>t.id===id);
      if(!task||task.assigned_to===currentUser?.id)return;
      if(!await ask('Patvirtinti rezultatą ir jums leidžiamus šios užduoties laiko įrašus?'))return;
      return run(()=>client.rpc('gi_approve_result_with_time',{p_task_id:id}),
        rows=>'Patvirtintas darbo rezultatas ir '+Number(rows||0)+' laiko įrašų.');
    }
    if(b.dataset.candidateTask && staff()){
      const task=tasks.find(t=>t.id===id);
      if(!task || task.assigned_to)return;
      const mark=!task.candidate_safe;
      if(mark && !await ask('Ar tai išgalvota, neskelbtina išvykos / mokymo užduotis, saugi kandidatui?'))return;
      return run(()=>client.rpc('gi_set_candidate_task',{
        p_id:id,p_safe:mark,p_kind:mark?'field_visit':(task.task_kind||'other')
      }));
    }
    if((b.dataset.assign||b.dataset.assignSelf)&&staff())return handleStaffAssignment(b,tasks.find(t=>t.id===id));
    if((b.dataset.setDue || b.dataset.clearDue) && staff()){
      const taskId=b.dataset.setDue || b.dataset.clearDue;
      const input=b.closest('details').querySelector('[data-due]');
      let due=null;
      if(b.dataset.setDue){
        try { due=window.giDeadlines.toInstant(input.value); }
        catch(error){input.focus();return toast(error.message,true);}
      }else if(!await ask('Pašalinti šios užduoties terminą?'))return;
      const previous=tasks.find(t=>t.id===taskId)?.due_at||null;
      return run(()=>client.rpc('gi_change_task_due',{p_id:taskId,p_expected:previous,p_due:due}),
        due?'Terminas išsaugotas: '+window.giDeadlines.display(due)+' (Vilniaus laiku).':'Terminas pašalintas.');
    }
    const action=b.dataset.step;
    if(!action)return;
    let note=null;
    if(action==='return'||action==='decline'){
      note=await ask(action==='return'?'Kodėl grąžini užduotį taisyti?':'Kodėl atsisakai užduoties?',{input:true});
      if(!note||note.trim().length<3)return notice('Įrašykite bent 3 simbolių priežastį.',true);
    }
    if(action==='approve'&&!await ask('Patvirtinti tik darbo rezultatą? Valandas galėsite peržiūrėti atskirai.'))return;
    if(action==='unassign'&&!await ask('Atšaukti paskyrimą? Užduotis grįš į bendrą fondą.'))return;
    const labels={claim:'Užduotis priskirta jums.',accept:'Užduotis priimta.',start:'Užduotis pradėta.',
      decline:'Užduotis grąžinta į bendrą fondą.',unassign:'Paskyrimas atšauktas.',
      publish:'Užduotis paskelbta fonde.',return:'Rezultatas grąžintas taisyti.'};
    run(()=>client.rpc('gi_task_action',{p_id:id,p_action:action,p_note:note}),labels[action]||'Užduotis atnaujinta.')
      .then(ok=>{if(ok&&(action==='claim'||action==='accept'))showTaskToastLink(id);});
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
  const handleTimeReviewClick=async(event)=>{
    const b=event.target.closest('button');
    if(!b||!staff())return;
    const id=b.dataset.timeApprove||b.dataset.timeReturn;
    if(!id)return;
    const row=workLogs.find(x=>x.id===id);
    if(!row||!reviewableLogs.has(row.id))return;
    const action=b.dataset.timeApprove?'approve':'return';
    let note=null;
    if(action==='return'){
      note=await ask('Kodėl reikia patikslinti darbo laiko įrašą?',{input:true});
      if(note===null)return;
      if(note.trim().length<3)return notice('Nurodykite priežastį.',true);
    }
    return run(()=>client.rpc('gi_review_work_log',{p_id:id,p_action:action,p_note:note}),
      action==='approve'?'Savanorio darbo laikas patvirtintas.':'Laiko įrašas grąžintas patikslinti.');
  };
  $('timeReportScope').addEventListener('change',()=>{
    const isProject=$('timeReportScope').value==='project';
    $('timeReportProjectField').hidden=!isProject;
    $('timeReportProject').required=isProject;
  });
  $('timeReportForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!staff()||!currentUser)return;
    const actor=currentUser.id,from=$('timeReportFrom').value,to=$('timeReportTo').value;
    const scope=$('timeReportScope').value,project=$('timeReportProject').value.trim();
    const button=$('timeReportDownload');
    if(button.disabled)return;
    if(!from||!to||from>to||to>$('timeReportTo').max)return toast('Patikrinkite ataskaitos datas.',true);
    if(scope==='project'&&project.length<2)return toast('Įrašykite projekto pavadinimą arba kodą.',true);
    button.disabled=true;
    try{
      const rows=[];let after=null;
      // Use a deterministic keyset and a safety cap: never download a partial
      // report silently or reuse the 70-row personal history / pending queue.
      for(;;){
        let query=client.from('gi_work_logs')
          .select('id,work_date,minutes,note,activity_title,project_label,general_activity,review_status,worker:gi_profiles!volunteer_id(display_name),job:gi_tasks!task_id(title)')
          .eq('review_status','approved').gte('work_date',from).lte('work_date',to)
          .order('id').limit(250);
        if(scope==='general')query=query.eq('general_activity',true);
        if(scope==='project')query=query.eq('general_activity',false).not('project_label','is',null);
        if(after)query=query.gt('id',after);
        const {data,error}=await query;
        if(error)throw error;
        if(currentUser?.id!==actor||!staff())return;
        if(!data?.length)break;
        rows.push(...data);
        if(rows.length>10000)throw Error('Pasirinkite trumpesnį laikotarpį.');
        const next=data[data.length-1].id;
        if(next===after)throw Error('Nepavyko patikimai gauti visų įrašų.');
        after=next;
        if(data.length<250)break;
      }
      const selected=rows.filter(w=>timeReportMatches(w,scope,project))
        .sort((a,b)=>a.work_date.localeCompare(b.work_date)||a.id.localeCompare(b.id));
      if(!selected.length)return toast('Nėra patvirtintų įrašų pagal pasirinktus kriterijus.',true);
      if(currentUser?.id!==actor||!staff())return;
      const url=window.URL.createObjectURL(new Blob([timeReportCsv(selected)],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download='GI-patvirtintos-valandos-'+from+'-'+to+'.csv';
      document.body.append(link);link.click();link.remove();setTimeout(()=>window.URL.revokeObjectURL(url),1000);
      toast('Eksportuota '+selected.length+' patvirtintų įrašų: '+clockDuration(selected.reduce((s,w)=>s+Number(w.minutes),0))+'.');
    }catch(error){toast('Ataskaita neatsisiųsta. '+(error?.message||'Patikrinkite ryšį.'),true);}
    finally{button.disabled=false;}
  });
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
      renderManualTimeTaskOptions();
      $('manualTimeDate').value=$('manualTimeDate').max;
      updateManualActivityMode();
      updateTimePresetButtons();
      $('timeEntryPanel').open=false;
      $('timeHistoryPanel').open=true;
    }
  });
  function caseActions(incident){
    if(!staff()||incident.status!=='submitted')return '';
    const item=cases.find(c=>c.incident_id===incident.id);
    const delegate='<details><summary>Priskirti patikrą savanoriui</summary><form data-delegate-incident="'+escapeHTML(incident.id)+'"><label class="field">Vykdytojas<select name="person" required>'+incidentPeopleOptions()+'</select></label><label class="field">Ką patikrinti?<textarea name="details" required minlength="5" maxlength="6000"></textarea></label><button>Priskirti patikrą</button></form></details>';
    if(!item)return delegate+'<button type="button" data-open-case="'+escapeHTML(incident.id)+'">Pradėti atvejo patikrą</button>';
    return delegate+'<details><summary>Atvejo užduotys</summary><p class="small">Atvejis '+escapeHTML(item.id.slice(0,8))+'</p>'
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
      await ask('Pažymėkite ir nukopijuokite užklausą.',{action:'Užverti',input:true,value:prompt});
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
    const note=action==='return'?await ask('Ką reikia pataisyti?',{input:true}):null;
    if(action==='return'&&(!note||note.trim().length<3))return;
    return run(()=>client.rpc('gi_document_step',{p_id:doc.id,p_revision:doc.revision,p_action:action,
      p_body:card.querySelector('[data-body]')?.value??null,p_note:note}),
      {save:'Versija išsaugota.',submit:'Dokumentas perduotas peržiūrai.',return:'Grąžinta rengėjui.',approve:'Dokumentas parengtas pasirašyti.'}[action]);
  });
  function incidentPeopleOptions(){
    return '<option value="">Pasirinkite savanorį</option>'+members.filter(m=>['volunteer','coordinator','admin'].includes(m.role)&&memberEmails[m.id]?.verified===true)
      .map(m=>'<option value="'+escapeHTML(m.id)+'">'+escapeHTML(personName(m))+'</option>').join('');
  }
  function updateIncidentDestination(){
    const assigned=$('incidentDestination').value==='assigned';
    $('incidentAssigneeWrap').hidden=!assigned;
    $('incidentAssignee').required=assigned;
    $('incidentReviewDetails').required=assigned;
  }
  function renderIncidentDestination(){
    const select=$('incidentDestination'),previous=select.value,old=$('incidentAssignee').value;
    select.innerHTML='<option value="review">Pateikti koordinatoriams (nepriskirta)</option>'
      +(['volunteer','coordinator','admin'].includes(profile?.role)?'<option value="team">Paskelbti komandai</option>':'')
      +(staff()?'<option value="assigned">Priskirti savanoriui</option>':'');
    if([...select.options].some(o=>o.value===previous))select.value=previous;
    $('incidentAssignee').innerHTML=incidentPeopleOptions();
    if([...$('incidentAssignee').options].some(o=>o.value===old))$('incidentAssignee').value=old;
    updateIncidentDestination();
  }
  $('incidentDestination').addEventListener('change',updateIncidentDestination);
  function resetIncident(){
    $('incidentForm').reset();incidentLocation.reset();$('incidentId').value='';
    $('incidentObserved').value=window.giDeadlines.inputValue(new Date());
    updateIncidentDestination();
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
    let number=0;
    for(const file of files){
      $('incidentProgress').textContent='Įkeliama nuotrauka '+(++number)+' iš '+files.length+'…';
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
    if(form.dataset.delegateIncident){
      event.preventDefault();
      const data=new FormData(form),id=form.dataset.delegateIncident,key='delegate:'+id;
      if(!caseRequest.has(key))caseRequest.set(key,crypto.randomUUID());
      return run(async()=>{
        const result=await client.rpc('gi_delegate_incident',{p_incident:id,p_ref:caseRequest.get(key),p_details:data.get('details'),p_volunteer:data.get('person')});
        if(!result.error)caseRequest.delete(key);
        return result;
      },'Patikra priskirta savanoriui.');
    }
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
      if(!await ask('Pašalinti šią nuotrauką iš juodraščio?'))return;
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
    incidentLocation.sync(item.extra_points||[]);
    $('incidentObserved').value=window.giDeadlines.inputValue(item.observed_at||item.created_at);
    $('incidentEditor').open=true;
    $('incidentForm').scrollIntoView({behavior:'smooth',block:'start'});
  });
  $('incidentForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(mutationInFlight)return;
    const submit=event.submitter?.value==='submit',desc=$('incidentDescription').value.trim();
    const destination=$('incidentDestination').value,assignee=$('incidentAssignee').value,reviewDetails=$('incidentReviewDetails').value.trim();
    incidentLocation.stop();
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
    const controls=Array.from(event.target.elements).filter(c=>c!==event.submitter&&!c.disabled);
    controls.forEach(c=>c.disabled=true);
    $('incidentProgress').textContent=submit?'Pateikiamas pranešimas…':'Saugomas juodraštis…';
    run(async()=>{
      const draft=await client.rpc('gi_incident_points_draft',{...payload,p_extra_points:incidentLocation.getExtra(),p_observed:window.giDeadlines.toInstant($('incidentObserved').value)});
      if(draft.error)throw draft.error;
      await uploadPhotos(payload.p_id,files);
      if(submit){
        const sent=destination==='review'?await client.rpc('gi_save_incident',{...payload,p_submit:true}):await client.rpc('gi_finish_incident',{...payload,p_destination:destination,p_volunteer:destination==='assigned'?assignee:null,p_details:destination==='assigned'?reviewDetails:null});
        if(sent.error)throw sent.error;
      }
      resetIncident();
    },submit?(destination==='team'?'Įvykis paskelbtas komandai.':destination==='assigned'?'Patikra priskirta savanoriui.':'Pranešimas pateiktas patikrai.'):'Juodraštis išsaugotas.').then(ok=>{controls.forEach(c=>c.disabled=false);$('incidentProgress').textContent='';if(ok)$('incidentEditor').open=false;});
  });
  let lastAutoRefreshAt=Date.now();
  function refreshWhenIdle(){
    // Focus and visibility events often fire together; don't repeat full data loads.
    if(Date.now()-lastAutoRefreshAt<60000 || loading)return;
    // A native date picker can blur the window; replacing its card discards the edit.
    if(mutationInFlight || feedbackSending || document.querySelector('#taskList details[open]') ||
       document.activeElement?.closest('#workspace form,#documentList [data-body]') || document.querySelector('#documentList textarea[data-dirty]'))return;
    lastAutoRefreshAt=Date.now();
    refreshWorkspace();
  }
  if(client){
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY')setTimeout(displayPasswordReset,0);
      if(event==='SIGNED_OUT'&&!passwordRecovery)setTimeout(showLoggedOut,0);
      if(event==='SIGNED_IN'&&session?.user&&!currentUser&&!passwordRecovery)setTimeout(onSignIn,0);
    });
    onSignIn().catch(e=>{if(!passwordRecovery)showLoggedOut();notice('Prisijungimo klaida: '+e.message,true);});
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
    $('authLoading').hidden=true;$('authView').hidden=false;
    notice('Nepavyko įkelti Supabase prisijungimo bibliotekos. Patikrink tinklą.',true);
  }
})();
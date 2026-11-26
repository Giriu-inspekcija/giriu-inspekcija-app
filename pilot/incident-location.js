'use strict';
// GPS button explicitly selects the location; saving still requires submitting the incident.
// Map tiles are requested only on explicit map opening; never automatically on GPS acquisition.
window.giIncidentLocation=function(){
  const el=id=>document.getElementById(id), map=el('incidentMap'), tiles=el('mapTiles'), pin=el('mapPin'),
    input=el('incidentCoords'), panel=el('incidentMapPanel'), gps=el('incidentGps'), gpsStatus=el('incidentGpsStatus'),
    status=el('incidentMapStatus'),gpsDot=el('mapGpsDot'),gpsCircle=el('mapGpsCircle'),scene=el('mapScene'),extraLayer=el('mapExtraPins'),pointList=el('incidentPointList');
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const wrap=(n,m)=>((n%m)+m)%m;
  const maxLat=85.05112878;
  const world=z=>256*2**z;
  function project(lat,lon,z){
    const size=world(z),s=Math.sin(clamp(lat,-maxLat,maxLat)*Math.PI/180);
    return [(lon+180)/360*size,(0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*size];
  }
  function unproject(x,y,z){
    const size=world(z);
    return [Math.atan(Math.sinh(Math.PI*(1-2*clamp(y,0,size)/size)))*180/Math.PI,wrap(x,size)/size*360-180];
  }
  let center=[55.2,24.0],zoom=8,selected=null,generation=0,drag=null;
  let best=null,watch=null,timer=null,searching=false;
  const tileNodes=new Map();
  const orthoService='https://www.geoportal.lt/mapproxy/rest/services/nzt_ort10lt_recent_wm/MapServer';
  const orthoMeta='https://www.geoportal.lt/metadata-catalog/catalog/search/resource/details.page?uuid=%7B5E116F93-97ED-4F0C-AE22-8C0C71A51C54%7D';
  let basemap='street',orthoTimer=null,orthoKey='',orthoReady=false,orthoFrame=null,orthoPending=null,orthoView=null;
  let orthoPeriod='recent';
  const geoRoot='https://www.geoportal.lt/mapproxy/rest/services/';
  // Older cycles approved by Geoportal by telephone, as reported by GI on 2026-11-26.
  const archiveRoot='https://www.geoportal.lt/mapproxy/';
  const periods={recent:orthoService,'2024-2026':geoRoot+'nzt_ort10lt_2024_2026/MapServer',
    '2021-2023':archiveRoot+'nzt_ort10lt_2021_2023/MapServer',
    '2018-2020':archiveRoot+'nzt_ort10lt_2018_2020/MapServer',
    '2015-2017':archiveRoot+'nzt_ort10lt_2015_2017/MapServer',
    '2012-2013':archiveRoot+'nzt_ort10lt_2012_2013/MapServer',
    '2009-2010':archiveRoot+'nzt_ort10lt_2009_2010/MapServer',
    '2005-2006':archiveRoot+'nzt_ort10lt_2005_2006/MapServer',
    '1995-1999':archiveRoot+'nzt_ort10lt_1995_2001/MapServer'};
  // Exact public sources already verified in GI's 2026-11-22 GIS audit.
  const standQuery=archiveRoot+'vmt_mkd/MapServer/1/query';
  const permitQuery='https://services6.arcgis.com/9d0vtWtIrdsf4pvs/arcgis/rest/services/lkmp_data/FeatureServer/0/query';
  const groupQuery=archiveRoot+'vmt_miskai/MapServer/7/query';
  const stateQuery=archiveRoot+'vmt_miskai/MapServer/8/query';
  const kmbQuery=archiveRoot+'vmt_miskai/MapServer/3/query';
  const ebQuery=archiveRoot+'am_bigis_spalvotas/MapServer/2/query';
  // STVK data published by the State Data Agency; the BAST/PAST layers
  // describe the Natura 2000 boundaries, not the agricultural aid restrictions.
  const stvkRoot='https://osp-sdg.stat.gov.lt/arcgis/rest/services/vstt_stvk/MapServer/';
  const protectionDefs=[
    {kind:'bast',label:'Natura 2000 · BAST',url:stvkRoot+'5/query',fields:'pavadinimas,bast_kodas'},
    {kind:'past',label:'Natura 2000 · PAST',url:stvkRoot+'14/query',fields:'pavadinimas,bast_kodas'},
    {kind:'park',label:'Parkas',url:stvkRoot+'13/query',fields:'pavadinimas'},
    {kind:'reserve',label:'Draustinis',url:stvkRoot+'6/query',fields:'pavadinimas'},
    {kind:'strict',label:'Rezervatas',url:stvkRoot+'15/query',fields:'pavadinimas'},
    {kind:'kmb',label:'KMB',url:kmbQuery,fields:'KMB_kod,KMB_tip_kod,pot_KMB_tip_kod'},
    {kind:'eb',label:'Inventorizuota EB buveinė',url:ebQuery,fields:'BIGISDBAnketos.BuveinesTipas'}
  ];
  function attribute(row,...keys){
    const entries=Object.entries(row||{});
    for(const key of keys){
      const match=entries.find(([k])=>k.toLowerCase()===key.toLowerCase());
      if(match&&match[1]!==null&&match[1]!==undefined&&String(match[1]).trim())return String(match[1]).trim();
    }
    return '';
  }
  function protectionText(kind,row){
    const name=attribute(row,'pavadinimas','sitename','name','st_pav');
    if(kind==='bast'||kind==='past'){
      const code=attribute(row,'bast_kodas','sitecode','site_code','natura_kodas','kodas');
      return [name,code&&code!==name?code:''].filter(Boolean).join(' · ')||'Teritorija (pavadinimas nepateiktas)';
    }
    if(kind==='kmb'){
      const code=attribute(row,'KMB_tip_kod','kmb_tipas','tipo_kodas','tipas');
      const num=attribute(row,'KMB_kod','KMB_nr','kmb_id','numeris');
      const potential=attribute(row,'pot_KMB_tip_kod');
      const label=attribute(row,'KMB_tip_pav','tip_pav','tipo_pav');
      return [code,label,potential&&'Potenciali KMB '+potential,num&&'Nr. '+num].filter(Boolean).join(' · ')||'Buveinės tipas nepateiktas';
    }
    if(kind==='eb'){
      const raw=attribute(row,'BIGISDBAnketos.BuveinesTipas','buv_kodas','buveines_kodas','buveine','buv_kod','kodas','habitatcode');
      const names={'9010':['9010*','Vakarų taiga'],'9020':['9020*','Plačialapių ir mišrūs miškai'],'9050':['9050','Žolių turtingi eglynai'],'9060':['9060','Spygliuočių miškai ant ozų'],'9070':['9070','Medžiais apaugusios ganyklos'],'9080':['9080*','Pelkėti lapuočių miškai'],'9160':['9160','Skroblynai'],'9180':['9180*','Griovų ir šlaitų miškai'],'9190':['9190','Sausieji ąžuolynai'],'91D0':['91D0*','Pelkiniai miškai'],'91E0':['91E0*','Aliuviniai miškai'],'91F0':['91F0','Paupių guobynai'],'91T0':['91T0','Kerpšiliai']};
      const mapped=names[raw.toUpperCase().replace(/\*$/,'')];
      const code=mapped?.[0]||raw;
      const type=attribute(row,'buv_pav','buveines_pavadinimas','buveines_tipas','pavadinimas')||mapped?.[1]||'';
      return [code,type&&type!==code?type:''].filter(Boolean).join(' · ')||'Buveinės kodas nepateiktas';
    }
    return name||'Pavadinimas nepateiktas';
  }
  function paintProtection(results){
    const list=el('forestProtectionList'),warning=el('forestProtectionStatus'),summary=el('forestProtectionSummary'),details=el('forestProtectionDetails');
    const lines=[],failed=[];
    for(const [def,result] of results){
      if(result.status!=='fulfilled'){failed.push(def.label);continue;}
      for(const value of new Set(result.value.map(row=>protectionText(def.kind,row)))){
        lines.push({label:def.kind==='kmb'&&value.startsWith('Potenciali KMB')?'pKMB':def.label,value});
      }
    }
    list.replaceChildren(...lines.map(({label,value})=>{
      const line=document.createElement('div');line.className='forest-protection-line';
      const title=document.createElement('strong');title.textContent=label;
      const detail=document.createElement('span');detail.textContent=value;
      line.append(title,detail);return line;
    }));
    details.hidden=!lines.length&&!failed.length;
    summary.textContent=lines.length?'Teritorijos ir buveinės ('+lines.length+')':'Teritorijų patikra';
    warning.hidden=!failed.length;warning.textContent=failed.length?'Nepavyko patikrinti: '+failed.join(', ')+'.':'';
    el('forestProtectionPreview').textContent=lines.length?lines.map(x=>x.label).filter((v,i,a)=>a.indexOf(v)===i).join(' · '):failed.length?'Ne visa teritorijų informacija patikrinta':'';
    el('forestProtectionPreview').hidden=!lines.length&&!failed.length;
  }
  async function loadProtection(p,controller,key){
    const results=await Promise.all(protectionDefs.map(async def=>{
      try{return [def,{status:'fulfilled',value:await queryAt(def.url,p,def.fields,controller.signal)}];}
      catch{return [def,{status:'rejected'}];}
    }));
    if(infoKey!==key||controller.signal.aborted)return;
    paintProtection(results);
  }
  const groupDefs={
    group1:{label:'I – rezervatiniai',where:'grupe = 1',color:'#ad1457'},
    group2a:{label:'IIA – ekosistemų apsaugos',where:'grupe = 2 AND pogrupis IN (21,22,23,24)',color:'#15803d'},
    group2b:{label:'IIB – rekreaciniai',where:'grupe = 2 AND pogrupis IN (25,26,27,28,29)',color:'#65a30d'},
    group3:{label:'III – apsauginiai',where:'grupe = 3',color:'#d97706'},
    group4:{label:'IV – ūkiniai',where:'grupe = 4',color:'#64748b'}
  };
  function classifyGroup(a){
    const g=Number(a.grupe),p=Number(a.pogrupis);
    if(g===1)return 'group1';
    if(g===2&&[21,22,23,24].includes(p))return 'group2a';
    if(g===2&&[25,26,27,28,29].includes(p))return 'group2b';
    if(g===3)return 'group3';if(g===4)return 'group4';return null;
  }
  function pointQueryUrl(endpoint,p,fields){
    return endpoint+'?'+new URLSearchParams({f:'json',where:'1=1',geometry:p[1]+','+p[0],geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:fields,returnGeometry:'false'});
  }
  async function queryAt(endpoint,p,fields,signal){
    const r=await fetch(pointQueryUrl(endpoint,p,fields),{signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!r.ok)throw Error('HTTP '+r.status);
    const d=await r.json();
    if(d.error||!Array.isArray(d.features)||d.exceededTransferLimit)throw Error('GIS query failed');
    return d.features.map(f=>f.attributes||{});
  }
  const infoCard=el('forestInfoCard'),infoDetails=el('forestInfoDetails'),infoButton=el('mapInspect');
  let inspectMode=false,inspected=null,infoPoint=null,infoTimer=null,infoAbort=null,infoKey='',detailKey='';
  function cancelInfo(){
    if(infoTimer!==null){clearTimeout(infoTimer);infoTimer=null;}
    if(infoAbort){infoAbort.abort();infoAbort=null;}
    infoKey='';detailKey='';infoPoint=null;
  }
  function setInspectMode(on){
    inspectMode=on;inspected=null;infoButton.setAttribute('aria-pressed',String(on));
    infoButton.title=on?'Baigti tyrinėti':'Tirti vietą';
    infoButton.setAttribute('aria-label',infoButton.title);
    el('mapInspectHint').hidden=!on;el('mapInspectPin').hidden=true;
    if(!on)showPointInfo(selected,'Įvykio vieta');
  }
  function setInfo(id,value){
    el(id).textContent=value;
    if(['forestInfoState','forestInfoSpecies','forestInfoAge'].includes(id)){
      const parts=['forestInfoState','forestInfoSpecies','forestInfoAge'].map(k=>el(k).textContent).filter(v=>v&&v!=='Tikrinama…');
      el('forestCompactFacts').textContent=parts.join(' · ')||'Tikrinama…';
    }
  }
  el('forestCopyCoords').addEventListener('click',async()=>{
    const p=infoPoint;if(!p)return;
    const value=format(p),out=el('forestCopyStatus');
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
      else {
        const field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();
        const ok=document.execCommand('copy');field.remove();if(!ok)throw Error('copy');
      }
      if(infoPoint&&format(infoPoint)===value)out.textContent='Nukopijuota';
    }catch{if(infoPoint&&format(infoPoint)===value)out.textContent='Nepavyko kopijuoti';}
  });
  function setSheetCollapsed(collapsed){
    const content=el('mapControlsContent'),toggle=el('mapSheetToggle');
    content.hidden=collapsed;toggle.setAttribute('aria-expanded',String(!collapsed));
    el('mapSheetToggleText').textContent=collapsed?'Rodyti valdiklius':'Sutraukti skydelį';
    el('mapSheetChevron').textContent=collapsed?'⌃':'⌄';
  }
  el('mapSheetToggle').addEventListener('click',()=>setSheetCollapsed(!el('mapControlsContent').hidden));
  function describeGroup(rows){
    if(!rows.length)return 'Grupė nerasta';
    const labels=[...new Set(rows.map(a=>groupDefs[classifyGroup(a)]?.label||(Number(a.grupe)===2?'II – pogrupis nenustatytas':'Grupė nenustatyta')))];
    return labels.join(' / ');
  }
  function ownershipLabel(value){
    const s=String(value??'').trim().toLocaleLowerCase('lt');
    if(/^privat/.test(s))return 'Privatus';
    if(/^valstyb/.test(s))return 'Valstybinis';
    if(/^savivaldyb/.test(s))return 'Savivaldybės';
    return null;
  }
  async function lookupOwnership(p,signal,permitRows){
    // The public VMT permits metadata confirms nuosavybes_forma.
    const [state,permits]=await Promise.allSettled([queryAt(stateQuery,p,'OBJECTID',signal),permitRows||queryAt(permitQuery,p,'id,nuosavybes_forma',signal)]);
    const labels=permits.status==='fulfilled'?[...new Set(permits.value.map(r=>ownershipLabel(r.nuosavybes_forma)).filter(Boolean))]:[];
    const stateHit=state.status==='fulfilled'&&state.value.length>0;
    if(stateHit&&labels.includes('Privatus'))return 'Duomenys nesutampa – tikrinti';
    if(labels.length)return labels.join(' / ')+' (VMT leidimas)';
    if(stateHit)return 'Valstybinis (VRM)';
    return 'Nenustatyta';
  }
  function speciesLabel(v){
    const names={P:'Pušis',E:'Eglė',B:'Beržas','Ą':'Ąžuolas',J:'Juodalksnis',Bt:'Baltalksnis',D:'Drebulė',U:'Uosis',K:'Klevas',L:'Liepa',G:'Guoba',Pb:'Bankso pušis',Pj:'Juodoji pušis'};
    return names[v]||v;
  }
  function permitDate(v){
    if(v===null||v===undefined||v==='')return '';
    const d=typeof v==='number'?new Date(v):new Date(String(v));
    if(!Number.isFinite(d.getTime()))return '';
    return new Intl.DateTimeFormat('lt-LT',{timeZone:'Europe/Vilnius',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  }
  function permitFacts(row){
    return [
      ['Nr.',attribute(row,'id')],
      ['Kirtimo rūšis',attribute(row,'kirtimo_rusis')],
      ['Išduotas',permitDate(row.isdavimo_data??row.isduota)],
      ['Galioja nuo',permitDate(row.galioja_nuo)],
      ['Galioja iki',permitDate(row.galioja_iki)],
      ['Būsena',attribute(row,'leid_busena')],
      ['Dokumento tipas',attribute(row,'tipas')],
      ['Kertamas plotas',attribute(row,'kertamas_plotas')?attribute(row,'kertamas_plotas')+' ha':'']
    ].filter(([,value])=>value);
  }
  function paintPermits(rows,failed=false){
    const details=el('forestPermitDetails'),summary=el('forestPermitSummary'),list=el('forestPermitList');
    details.hidden=!rows.length&&!failed;
    summary.textContent=failed?'Kirtimų leidimų patikra':'Kirtimų leidimai / pranešimai ('+rows.length+')';
    list.replaceChildren();
    if(failed){list.textContent='Nepavyko patikrinti leidimų. Bandykite dar kartą.';return;}
    for(const row of rows){
      const dl=document.createElement('dl');
      for(const [label,value] of permitFacts(row)){
        const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;dl.append(dt,dd);
      }
      const box=document.createElement('div');box.className='forest-permit-entry';box.append(dl);list.append(box);
    }
  }
  function describeStand(rows){
    if(!rows.length)return {age:'Medynas nerastas',species:'Nerasta',parcel:'Nerasta'};
    const age=[...new Set(rows.map(r=>Number(r.AMZ)).filter(a=>Number.isFinite(a)&&a>0))].sort((a,b)=>a-b);
    const parcel=[...new Set(rows.map(r=>[r.kv_nr,r.skl_nr].map(v=>v==null||v===''?'?':String(v)).join(' / ')))];
    const species=[...new Set(rows.map(r=>String(r.VMR??'').trim()).filter(v=>v&&v!=='0'&&v!=='-'))];
    return {age:age.length?age.map(n=>n+' m.').join(' / '):'Amžius nenurodytas',species:species.length?species.map(speciesLabel).join(' / '):'Rūšis nenurodyta',parcel:parcel.join('; ')};
  }
  function showPointInfo(p,title='Įvykio vieta'){
    if(!p){cancelInfo();infoCard.hidden=true;return;}
    const key=title+'|'+format(p);
    if(key===infoKey)return;
    cancelInfo();infoKey=key;infoPoint=[...p];infoCard.hidden=false;
    infoDetails.open=false;el('forestMainDetails').open=false;el('forestCopyStatus').textContent='';el('forestProtectionDetails').open=false;el('forestProtectionDetails').hidden=true;
    el('forestProtectionList').replaceChildren();el('forestProtectionStatus').hidden=true;
    el('forestProtectionPreview').hidden=false;setInfo('forestProtectionPreview','Tikrinamos teritorijos ir buveinės…');
    setInfo('forestInfoTitle',title);setInfo('forestInfoCoords',format(p));
    for(const id of ['forestInfoGroup','forestInfoAge','forestInfoSpecies','forestInfoParcel','forestInfoState'])setInfo(id,'Tikrinama…');
    el('forestPermitDetails').open=false;el('forestPermitDetails').hidden=true;el('forestPermitList').replaceChildren();
    infoTimer=setTimeout(async()=>{
      infoTimer=null;const controller=new AbortController();infoAbort=controller;
      const current=()=>infoKey===key&&!controller.signal.aborted;
      void loadProtection(p,controller,key);
      const permits=queryAt(permitQuery,p,'id,kirtimo_rusis,galioja_nuo,galioja_iki,leid_busena,tipas,kertamas_plotas,nuosavybes_forma',controller.signal);
      permits.then(rows=>{if(current())paintPermits(rows);},()=>{if(current())paintPermits([],true);});
      const ownership=lookupOwnership(p,controller.signal,permits).then(v=>{if(current())setInfo('forestInfoState',v);}).catch(()=>{if(current())setInfo('forestInfoState','Nepavyko patikrinti');});
      const [g,s]=await Promise.allSettled([queryAt(groupQuery,p,'grupe,pogrupis',controller.signal),queryAt(standQuery,p,'AMZ,VMR,kv_nr,skl_nr',controller.signal)]);
      if(!current())return;
      setInfo('forestInfoGroup',g.status==='fulfilled'?describeGroup(g.value):'Nepavyko patikrinti');
      const stand=s.status==='fulfilled'?describeStand(s.value):{age:'Nepavyko patikrinti',species:'Nepavyko patikrinti',parcel:'Nepavyko patikrinti'};
      setInfo('forestInfoAge',stand.age);setInfo('forestInfoSpecies',stand.species);setInfo('forestInfoParcel',stand.parcel);
      if(infoDetails.open)loadInfoDetails();
    },350);
  }
  async function loadInfoDetails(){
    if(!infoPoint||!infoDetails.open||detailKey===infoKey)return;
    const key=infoKey,p=[...infoPoint];detailKey=key;
    const controller=infoAbort||new AbortController();infoAbort=controller;
    // Core and permit data are already fetched for this point; opening is local only.
  }
  infoDetails.addEventListener('toggle',()=>{if(infoDetails.open&&infoTimer===null)loadInfoDetails();});
  el('forestInfoRetry').addEventListener('click',()=>{const p=infoPoint,title=el('forestInfoTitle').textContent;cancelInfo();if(p)showPointInfo(p,title);});
  infoButton.addEventListener('click',()=>setInspectMode(!inspectMode));
  const layerDefs={
    old120:{vector:true,credit:'AMZ: © VMT / RC / geoportal.lt'},
    old180:{vector:true,credit:'AMZ: © VMT / RC / geoportal.lt'},
    permits:{vector:true,credit:'Leidimai: © VMT'},
    parcels:{service:'vmt_mkd',ids:[0,1],credit:'© RC / geoportal.lt'},
    kmb:{service:'vmt_miskai',ids:[3],credit:'© VMT / geoportal.lt'},
    groups:{vector:true,credit:'© VMT / geoportal.lt'},
    ...Object.fromEntries(Object.keys(groupDefs).map(k=>[k,{vector:true,credit:'© VMT / geoportal.lt'}])),
    state:{service:'vmt_miskai',ids:[8],credit:'© VMT / geoportal.lt'},
    habitats:{service:'am_bigis_spalvotas',ids:[],credit:'© AM / GIS-Centras',all:true},
    restrictions:{service:'vstt_natura_apribojimai',ids:[0,1,2,3],credit:'© VSTT'}
  };
  const overlayPane=el('mapOverlays'),overlayStatus=el('mapOverlayStatus'),overlayCredit=el('mapOverlayCredit'),layerMenu=el('mapLayerMenu'),periodControl=el('mapOrthoPeriod');
  let overlayKey='',overlayTimer=null,overlayAbort=null;
  const selectedLayers=new Set();
  function clearOverlays(){
    if(overlayTimer!==null){clearTimeout(overlayTimer);overlayTimer=null;}
    if(overlayAbort){overlayAbort.abort();overlayAbort=null;}
    overlayKey='';overlayPane.replaceChildren();overlayStatus.textContent='';
  }
  function overlayImageUrl(service,ids,left,top,w,h,z){
    const u=new URL(orthoImageUrl(left,top,w,h,z,geoRoot+service+'/MapServer'));
    u.searchParams.set('format','png32');u.searchParams.set('transparent','true');
    if(ids.length)u.searchParams.set('layers','show:'+ids.join(','));
    return u.toString();
  }
  function vectorQueryUrl(endpoint,where,fields,left,top,w,h,z){
    // WGS84 envelope matches the working 2026-11-22 VMT audit query.
    const n=world(z),lon=x=>Math.max(-180,Math.min(180,x/n*360-180)),
      lat=y=>Math.atan(Math.sinh(Math.PI*(1-2*Math.max(0,Math.min(n,y))/n)))*180/Math.PI;
    const bbox=[lon(left),lat(top+h),lon(left+w),lat(top)];
    const q=new URLSearchParams({f:'geojson',where,outFields:fields,returnGeometry:'true',
      geometry:bbox.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',outSR:'4326',
      spatialRel:'esriSpatialRelIntersects'});
    return endpoint+'?'+q;
  }
  function featurePath(geometry,left,top,z){
    const polygons=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
    if(!Array.isArray(polygons))return '';
    const paths=[];
    for(const polygon of polygons)for(const ring of polygon){
      if(!Array.isArray(ring)||ring.length<4||ring.some(p=>!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90))continue;
      const points=ring.map(([lon,lat])=>{const [x,y]=project(lat,lon,z);return (x-left).toFixed(2)+' '+(y-top).toFixed(2);});
      paths.push('M'+points.join(' L')+' Z');
    }
    return paths.join(' ');
  }
  function vectorPaint(data,req,left,top,w,h,z){
    if(req.kind==='groups'&&Array.isArray(data.features)&&!data.error&&data.type!=='FeatureCollection'){
      data={...data,type:'FeatureCollection',features:data.features.map(f=>({properties:f.attributes,geometry:{type:'Polygon',coordinates:f.geometry?.rings||[]}}))};
    }
    if(data.error||data.type!=='FeatureCollection'||!Array.isArray(data.features))throw Error('Invalid GIS response');
    if(data.exceededTransferLimit||data.properties?.exceededTransferLimit||data.features.length>=1000)throw Error('GIS response truncated; zoom in');
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 '+w+' '+h);svg.setAttribute('width',String(w));svg.setAttribute('height',String(h));
    svg.setAttribute('class','map-vector');svg.setAttribute('aria-hidden','true');
    let count=0;
    for(const feature of data.features){
      const rawAge=feature.properties?.AMZ,age=Number(rawAge);
      if(req.kind==='stands'&&(rawAge===null||rawAge===undefined||!Number.isFinite(age)||age<req.minAge))continue;
      const group=req.kind==='groups'?classifyGroup(feature.properties||{}):null;
      if(req.kind==='groups'&&!req.allGroups&&!req.keys.includes(group))continue;
      const groupColor=groupDefs[group]?.color||'#94a3b8';
      const d=featurePath(feature.geometry,left,top,z);if(!d)continue;
      const p=document.createElementNS(ns,'path');p.setAttribute('d',d);p.setAttribute('fill-rule','evenodd');
      p.setAttribute('fill',req.kind==='groups'?groupColor:req.kind==='permits'?'#dc2626':age>=180?'#7c3aed':'#eab308');
      p.setAttribute('fill-opacity',req.kind==='groups'?'0.27':req.kind==='permits'?'0.12':'0.38');
      p.setAttribute('stroke',req.kind==='groups'?groupColor:req.kind==='permits'?'#dc2626':age>=180?'#7c3aed':'#a16207');
      p.setAttribute('stroke-width',req.kind==='permits'?'2.2':'1.5');
      svg.append(p);count++;
    }
    // Raster layers are below vectors; permits above ages; pins remain above both.
    svg.style.zIndex=req.kind==='groups'?'1':req.kind==='permits'?'3':'2';
    overlayPane.append(svg);return count;
  }
  function renderOverlays(left,top,w,h){
    if(!selectedLayers.size){clearOverlays();overlayCredit.textContent='';return;}
    overlayCredit.textContent=[...new Set([...selectedLayers].map(k=>layerDefs[k].credit))].join(' · ');
    if(zoom<12){clearOverlays();overlayStatus.textContent='Priartinkite žemėlapį, kad matytumėte pasirinktus sluoksnius.';return;}
    const grouped=new Map();
    for(const key of selectedLayers){
      const d=layerDefs[key];if(d.vector)continue;
      if(!grouped.has(d.service))grouped.set(d.service,{ids:[],keys:[]});
      const g=grouped.get(d.service);g.ids.push(...d.ids);g.keys.push(key);
    }
    const requests=[...grouped].map(([service,g])=>({url:overlayImageUrl(service,[...new Set(g.ids)].sort((a,b)=>a-b),left,top,w,h,zoom),keys:g.keys}));
    const groupKeys=Object.keys(groupDefs).filter(k=>selectedLayers.has(k)),allGroups=selectedLayers.has('groups');
    if(allGroups||groupKeys.length){
      const where=allGroups?'1=1':groupKeys.map(k=>'('+groupDefs[k].where+')').join(' OR ');
      const u=new URL(vectorQueryUrl(groupQuery,where,'grupe,pogrupis,OBJECTID',left,top,w,h,zoom));u.searchParams.set('f','json');
      requests.push({kind:'groups',keys:allGroups?['groups',...groupKeys]:groupKeys,allGroups,url:u.toString()});
    }
    const standKeys=['old120','old180'].filter(k=>selectedLayers.has(k));
    if(standKeys.length){
      const minAge=selectedLayers.has('old120')?120:180;
      requests.push({kind:'stands',minAge,keys:standKeys,url:vectorQueryUrl(standQuery,'AMZ >= '+minAge,'AMZ,OBJECTID',left,top,w,h,zoom)});
    }
    if(selectedLayers.has('permits'))requests.push({kind:'permits',keys:['permits'],url:vectorQueryUrl(permitQuery,'1=1','id',left,top,w,h,zoom)});
    const key=requests.map(r=>r.url).join('|');
    if(overlayKey===key)return;
    clearOverlays();overlayKey=key;overlayStatus.textContent='Įkeliami sluoksniai…';
    overlayTimer=setTimeout(()=>{
      overlayTimer=null;if(panel.hidden||overlayKey!==key)return;
      const controller=new AbortController();overlayAbort=controller;
      let remaining=requests.length;const failed=[],counts=[];
      function finish(req,ok,count){
        if(overlayKey!==key||panel.hidden)return;
        if(!ok)failed.push(...req.keys.map(k=>el('layer-'+k).parentElement.textContent.trim()));
        if(ok&&Number.isInteger(count))counts.push((req.kind==='groups'?'Grupių plotai':req.kind==='stands'?'Medynai':'Leidimai')+': '+count);
        if(--remaining===0){overlayAbort=null;overlayStatus.textContent=(failed.length?'Nepavyko įkelti: '+failed.join(', ')+'. ':'')+counts.join(' · ');}
      }
      for(const req of requests){
        if(req.kind){
          fetch(req.url,{signal:controller.signal,credentials:'omit'}).then(r=>{if(!r.ok)throw Error('GIS HTTP '+r.status);return r.json();}).then(data=>{
            if(panel.hidden||overlayKey!==key||controller.signal.aborted)return;
            const count=vectorPaint(data,req,left,top,w,h,zoom);finish(req,true,count);
          }).catch(()=>{if(!controller.signal.aborted)finish(req,false);});
          continue;
        }
        const img=document.createElement('img');img.alt='';img.draggable=false;img.referrerPolicy='strict-origin-when-cross-origin';
        img.style.width=w+'px';img.style.height=h+'px';
        img.addEventListener('load',()=>finish(req,true),{once:true});
        img.addEventListener('error',()=>{img.remove();finish(req,false);},{once:true});
        overlayPane.append(img);img.src=req.url;
      }
    },350);
  }
  function updateLayerButton(){el('mapLayersToggle').textContent='Sluoksniai'+(selectedLayers.size?' ('+selectedLayers.size+')':'');}
  el('mapLayersToggle').addEventListener('click',()=>{layerMenu.hidden=!layerMenu.hidden;el('mapLayersToggle').setAttribute('aria-expanded',String(!layerMenu.hidden));});
  for(const k of Object.keys(layerDefs))el('layer-'+k).addEventListener('change',e=>{
    if(e.target.checked)selectedLayers.add(k);else selectedLayers.delete(k);
    clearOverlays();updateLayerButton();render();
  });
  el('mapOverlayRetry').addEventListener('click',()=>{clearOverlays();render();});
  periodControl.addEventListener('change',()=>{
    if(!Object.hasOwn(periods,periodControl.value))return;
    orthoPeriod=periodControl.value;basemap='ortho';clearOrtho();tileNodes.clear();tiles.replaceChildren();updateBasemap();render();
  });
  const orthoButton=el('mapBasemap'),credit=el('mapCredit'),orthoStatus=el('mapBasemapStatus');
  // Convert the displayed Web Mercator pixel extent to metres; the Geoportal cache
  // has a different origin and level numbering from OSM. Never substitute XYZ tiles.
  function orthoImageUrl(left,top,w,h,z,service=orthoService){
    const half=20037508.342789244,step=2*half/world(z);
    const bbox=[left*step-half,half-(top+h)*step,(left+w)*step-half,half-top*step];
    const scale=Math.min(1,4096/Math.max(w,h));
    const size=[Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale))];
    return service+'/export?'+new URLSearchParams({bbox:bbox.join(','),bboxSR:'3857',imageSR:'3857',size:size.join(','),format:'jpg',f:'image'});
  }
  function frameCovers(frame,view){
    if(!frame||frame.period!==view.period||frame.z!==view.z)return false;
    return view.left>=frame.left&&view.top>=frame.top&&view.left+view.w<=frame.left+frame.w&&view.top+view.h<=frame.top+frame.h;
  }
  function frameBounds(view){
    // A modest guard band inside the same interactive display request, not a tile cache.
    const px=Math.ceil(view.w*.25),py=Math.ceil(view.h*.25);
    return {left:Math.floor(view.left)-px,top:Math.floor(view.top)-py,w:Math.ceil(view.w)+2*px+1,h:Math.ceil(view.h)+2*py+1,z:view.z,period:view.period};
  }
  function positionOrtho(frame,view){
    const scale=2**(view.z-frame.z),img=frame.img;
    img.style.left=(frame.left*scale-view.left)+'px';img.style.top=(frame.top*scale-view.top)+'px';
    img.style.width=frame.w*scale+'px';img.style.height=frame.h*scale+'px';
  }
  function cancelOrthoPending(){
    if(orthoTimer!==null){clearTimeout(orthoTimer);orthoTimer=null;}
    if(orthoPending){orthoPending.img?.remove();orthoPending=null;}
    orthoKey='';
  }
  function clearOrtho(){
    cancelOrthoPending();orthoFrame=null;orthoView=null;orthoReady=false;
  }
  function renderOrtho(left,top,w,h){
    const view={left,top,w,h,z:zoom,period:orthoPeriod};orthoView=view;
    if(orthoFrame)positionOrtho(orthoFrame,view);
    orthoReady=frameCovers(orthoFrame,view);
    const readyText=()=> (orthoPeriod==='recent'?'Aktualiausias ORT10LT':orthoPeriod+' m. ciklas')+' · konkrečios vietos fotografavimo data nenurodyta.';
    if(orthoReady){
      cancelOrthoPending();orthoStatus.textContent=readyText();return;
    }
    if(frameCovers(orthoPending,view))return;
    cancelOrthoPending();
    const frame=frameBounds(view),url=orthoImageUrl(frame.left,frame.top,frame.w,frame.h,frame.z,periods[frame.period]);
    orthoKey=url;orthoPending=frame;
    orthoStatus.textContent=orthoFrame?'Tikslinamas ortofoto vaizdas…':'Įkeliama ortofoto…';
    // Keep the currently loaded image aligned during pan and pinch until replacement
    // is ready. One debounced request, no persistent storage or background downloads.
    orthoTimer=setTimeout(()=>{
      orthoTimer=null;
      if(panel.hidden||basemap!=='ortho'||orthoKey!==url||orthoPending!==frame)return;
      const img=document.createElement('img');frame.img=img;img.alt='';img.draggable=false;
      img.referrerPolicy='strict-origin-when-cross-origin';img.style.visibility='hidden';
      positionOrtho(frame,orthoView);
      img.addEventListener('load',()=>{
        if(!img.isConnected||orthoPending!==frame||orthoKey!==url||panel.hidden||basemap!=='ortho')return;
        const old=orthoFrame;orthoFrame=frame;orthoPending=null;orthoKey='';
        positionOrtho(frame,orthoView);img.style.visibility='visible';old?.img.remove();
        orthoReady=frameCovers(frame,orthoView);
        if(orthoReady)orthoStatus.textContent=readyText();else renderOrtho(orthoView.left,orthoView.top,orthoView.w,orthoView.h);
      },{once:true});
      img.addEventListener('error',()=>{
        if(orthoPending!==frame||orthoKey!==url)return;
        img.remove();orthoPending=null;orthoKey='';orthoReady=frameCovers(orthoFrame,orthoView);
        orthoStatus.textContent='Ortofoto nepasiekiama. Perjunkite į žemėlapį arba bandykite dar kartą.';
      },{once:true});
      tiles.append(img);img.src=url;
    },300);
  }
  function updateBasemap(){
    const ortho=basemap==='ortho';
    orthoButton.setAttribute('aria-pressed',String(ortho));
    orthoButton.textContent=ortho?'Žemėlapis':'Ortofoto';
    el('mapPeriodWrap').hidden=!ortho;periodControl.value=orthoPeriod;
    orthoButton.setAttribute('aria-label',ortho?'Rodyti įprastą žemėlapį':'Rodyti aktualiausią ortofoto');
    credit.href=ortho?(orthoPeriod==='recent'?orthoMeta:periods[orthoPeriod]):'https://www.openstreetmap.org/copyright';
    credit.textContent=ortho?'ORT10LT © NŽT prie AM, © geoportal.lt, © SSVA':'© OpenStreetMap';
    if(!ortho)orthoStatus.textContent='';
  }
  orthoButton.addEventListener('click',()=>{
    basemap=basemap==='street'?'ortho':'street';
    clearOrtho();tileNodes.clear();tiles.replaceChildren();updateBasemap();render();
  });
  let extras=[],multi=false,gpsIndex=0,pinch=null,gestureConsumed=false;
  const pointers=new Map();
  function shift(dx=0,dy=0,scale=1,origin=null){
    scene.style.transformOrigin=origin?origin[0]+'px '+origin[1]+'px':'50% 50%';
    scene.style.transform='translate3d('+dx+'px,'+dy+'px,0) scale('+scale+')';
  }
  function allPoints(){return selected?[selected,...extras]:[];}
  function updatePoints(){
    const points=allPoints();
    el('incidentPointCount').textContent=points.length?('Pažymėta: '+points.length+' iš 20'):'';
    el('incidentPointsSummary').textContent=points.length?'('+points.length+')':'';
    el('incidentNoPoints').hidden=points.length>0;
    el('incidentLocationClear').hidden=points.length===0;
    el('mapPointMode').setAttribute('aria-pressed',String(multi));
    el('mapPointMode').textContent=multi?'✓ Taškai':'+ Taškai';
    el('mapAddGps').hidden=!multi;
    pointList.replaceChildren(...points.map((p,i)=>{
      const row=document.createElement('div');row.className='point-row';
      const label=document.createElement('span');label.textContent=(i+1)+'. '+format(p);
      const b=document.createElement('button');b.type='button';b.className='point-remove';const glyph=document.createElement('span');glyph.className='remove-glyph';glyph.textContent='×';glyph.setAttribute('aria-hidden','true');b.append(glyph);b.dataset.removePoint=String(i);b.setAttribute('aria-label','Pašalinti tašką '+(i+1));row.append(label,b);return row;
    }));
  }
  function writePoint(p,index){
    if(index===0){selected=p;input.value=format(p);}
    else extras[index-1]=p;
    updatePoints();
    if(!inspectMode)showPointInfo(p,'Įvykio taškas '+(index+1));
  }
  function chooseIndex(){
    if(!multi||!selected)return 0;
    if(allPoints().length>=20){status.textContent='Galima pažymėti iki 20 taškų.';return -1;}
    return allPoints().length;
  }
  const format=p=>p.map(n=>Number(n).toFixed(6)).join(', ');
  function parse(raw){
    const m=raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
    if(!m)return null;
    const p=[Number(m[1]),Number(m[2])];
    return Math.abs(p[0])<=90&&Math.abs(p[1])<=180?p:null;
  }
  function render(){
    if(panel.hidden)return;
    const w=map.clientWidth,h=map.clientHeight;
    if(!w||!h)return;
    const [cx,cy]=project(...center,zoom),left=cx-w/2,top=cy-h/2,n=2**zoom;
    if(basemap==='ortho')renderOrtho(left,top,w,h);
    else{
    const visible=new Set();
    for(let y=Math.floor(top/256);y<=Math.floor((top+h-1)/256);y++){
      if(y<0||y>=n)continue;
      for(let x=Math.floor(left/256);x<=Math.floor((left+w-1)/256);x++){
        const key=zoom+'/'+x+'/'+y;visible.add(key);
        let img=tileNodes.get(key);
        if(!img){
          img=document.createElement('img');img.alt='';img.draggable=false;
          img.referrerPolicy='strict-origin-when-cross-origin';
          img.src='https://tile.openstreetmap.org/'+zoom+'/'+wrap(x,n)+'/'+y+'.png';
          img.addEventListener('error',()=>{if(img.isConnected)status.textContent='Žemėlapio vaizdas nepasiekiamas. Koordinates galima įvesti ranka.';},{once:true});
          tileNodes.set(key,img);tiles.append(img);
        }
        img.style.left=(x*256-left)+'px';img.style.top=(y*256-top)+'px';
      }
    }
    for(const [key,img] of tileNodes)if(!visible.has(key)){img.remove();tileNodes.delete(key);}
    }
    renderOverlays(left,top,w,h);
    shift();
    function position(node,p){
      const [px,py]=project(...p,zoom),dx=wrap(px-cx+world(zoom)/2,world(zoom))-world(zoom)/2;
      node.style.left=(w/2+dx)+'px';node.style.top=(h/2+py-cy)+'px';node.hidden=false;
    }
    if(selected){position(pin,selected);pin.textContent='1';}else pin.hidden=true;
    if(inspectMode&&inspected)position(el('mapInspectPin'),inspected);else el('mapInspectPin').hidden=true;
    extraLayer.replaceChildren(...extras.map((p,i)=>{
      const marker=document.createElement('span');marker.className='map-extra-pin';marker.textContent=String(i+2);
      position(marker,p);return marker;
    }));
    if(best){
      position(gpsDot,best.point);position(gpsCircle,best.point);
      const metresPerPixel=40075016.686*Math.cos(clamp(best.point[0],-maxLat,maxLat)*Math.PI/180)/world(zoom);
      const diameter=clamp(2*best.accuracy/metresPerPixel,10,100000);
      gpsCircle.style.width=gpsCircle.style.height=diameter+'px';
    }else{gpsDot.hidden=true;gpsCircle.hidden=true;}

  }
  function choose(p){
    if(basemap==='ortho'&&!orthoReady){status.textContent='Palaukite ortofoto arba pasirinkite įprastą žemėlapį.';return;}
    if(inspectMode){inspected=p;showPointInfo(p,'Tiriama vieta (ne įvykio taškas)');render();return;}
    const index=chooseIndex();if(index<0)return;
    stop();writePoint(p,index);
    gpsStatus.textContent='Vieta pasirinkta žemėlapyje.';
    status.textContent='';
    render();
  }
  function sync(savedExtras){
    selected=parse(input.value);
    if(Array.isArray(savedExtras))extras=savedExtras.filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180).slice(0,19);
    if(!selected)extras=[];
    updatePoints();
    if(selected){center=[...selected];zoom=16;status.textContent='Įvykiui pasirinkta: '+format(selected);}
    else status.textContent='Įvykiui vieta dar nepasirinkta.';
    if(!selected)showPointInfo(null);
    else if(!inspectMode&&infoPoint&&!allPoints().some(p=>format(p)===format(infoPoint))) {cancelInfo();infoCard.hidden=true;}
    render();
  }
  function closeMap(){
    fullscreen(false);panel.hidden=true;el('forestInfoOutside').append(infoCard);if(inspectMode)setInspectMode(false);clearOrtho();clearOverlays();layerMenu.hidden=true;el('mapLayersToggle').setAttribute('aria-expanded','false');orthoStatus.textContent='';tiles.replaceChildren();tileNodes.clear();extraLayer.replaceChildren();shift();drag=null;pinch=null;pointers.clear();gestureConsumed=false;pin.hidden=true;gpsDot.hidden=true;gpsCircle.hidden=true;
    el('incidentMapOpen').hidden=false;el('incidentMapOpen').setAttribute('aria-expanded','false');
  }
  function stop(){
    generation++;searching=false;
    if(timer!==null){clearTimeout(timer);timer=null;}
    if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null;}
    gps.disabled=false;gps.textContent='◎ Nustatyti GPS';
  }
  function reset(){
    stop();best=null;basemap='street';orthoPeriod='recent';selectedLayers.clear();for(const k of Object.keys(layerDefs))el('layer-'+k).checked=false;updateLayerButton();overlayCredit.textContent='';updateBasemap();
    gpsStatus.textContent='Vieta nepasirinkta.';
    selected=null;extras=[];multi=false;setInspectMode(false);showPointInfo(null);updatePoints();center=[55.2,24.0];zoom=8;drag=null;status.textContent='';closeMap();
  }
  function showFix(select=true){
    if(!best)return;
    const accuracy=Math.ceil(best.accuracy);
    gpsStatus.textContent=(searching?'Tikslinama… ':'GPS nustatyta. ')+'Tikslumas ±'+accuracy+' m.'
      +(accuracy>25?' Vieta apytikslė – patikrinkite žemėlapyje.':'')
      +(select?' Vieta pasirinkta.':'');
  }
  function startGps(select=true){
    if(!navigator.geolocation){gpsStatus.textContent='GPS nepalaikomas. Galite naudoti žemėlapį arba rankines koordinates.';return;}
    const index=select?chooseIndex():0;if(index<0)return;
    stop();best=null;gpsIndex=index;const token=generation;searching=true;
    gps.disabled=true;gps.textContent='Tikslinama…';
    gpsStatus.textContent='Ieškoma vietos. Jei prašoma, suteikite vietos leidimą.';
    function finish(message){
      if(token!==generation)return;
      stop();
      if(best)showFix(select);else gpsStatus.textContent=message;
    }
    const receive=({coords})=>{
      if(token!==generation)return;
      const {latitude,longitude,accuracy}=coords;
      if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||!Number.isFinite(accuracy)||accuracy<=0||Math.abs(latitude)>90||Math.abs(longitude)>180)return;
      if(!best||accuracy<best.accuracy){best={point:[latitude,longitude],accuracy};
        if(select)writePoint([...best.point],gpsIndex);showFix(select);
        status.textContent='';
        if(!panel.hidden&&!drag&&!pinch){center=[...best.point];zoom=16;render();}}
      if(best.accuracy<=15)finish('');
    };
    const fail=error=>{if(token!==generation)return;if(error.code===1||!best)finish(({1:'Vietos leidimas nesuteiktas. Patikrinkite tikslios vietos leidimą.',2:'GPS vieta nepasiekiama. Bandykite atviroje vietoje.',3:'GPS paieškos laikas baigėsi. Bandykite dar kartą.'}[error.code]||'Nepavyko nustatyti vietos.')+' Galima pasirinkti tašką ranka.');};
    try{
      timer=setTimeout(()=>finish('GPS vietos nustatyti nepavyko. Bandykite dar kartą.'),20000);
      const id=navigator.geolocation.watchPosition(receive,fail,{enableHighAccuracy:true,timeout:20000,maximumAge:0});
      if(token===generation)watch=id;else navigator.geolocation.clearWatch(id);
    }catch{finish('Vietos nustatyti nepavyko. Patikrinkite leidimus.');}
  }
  gps.addEventListener('click',()=>startGps());
  function openMapAt(p){
    panel.hidden=false;el('forestInfoInside').append(infoCard);el('incidentMapOpen').hidden=true;el('incidentMapOpen').setAttribute('aria-expanded','true');
    if(p){center=[...p];zoom=16;}if(selected&&!inspectMode)showPointInfo(selected,'Įvykio taškas 1');render();
  }
  el('incidentMapOpen').addEventListener('click',()=>{
    if(!panel.hidden){closeMap();return;}
    selected=parse(input.value);
    openMapAt(best?.point||selected);
    status.textContent=selected?'':'Palieskite žemėlapį, kad pasirinktumėte vietą.';
  });
  el('mapMyLocation').addEventListener('click',()=>{
    if(best)openMapAt(best.point);else startGps(false);
  });
  input.addEventListener('change',()=>{stop();sync();if(!inspectMode)showPointInfo(selected,'Įvykio taškas 1');gpsStatus.textContent=input.value?'Vieta pasirinkta ranka.':'Vieta nepasirinkta.';});
  el('mapPointMode').addEventListener('click',()=>{multi=!multi;updatePoints();status.textContent=multi?'Palieskite žemėlapį ir pridėkite taškų.':'';});
  el('mapAddGps').addEventListener('click',()=>{multi=true;updatePoints();gps.click();});
  pointList.addEventListener('click',e=>{
    const b=e.target.closest('[data-remove-point]');if(!b)return;
    stop();const points=allPoints();points.splice(Number(b.dataset.removePoint),1);
    selected=points.shift()||null;extras=points;input.value=selected?format(selected):'';updatePoints();render();
    if(!inspectMode)showPointInfo(selected,'Įvykio taškas 1');
    gpsStatus.textContent=selected?'Vieta pasirinkta.':'Vieta nepasirinkta.';
  });
  function fullscreen(on){
    panel.classList.toggle('map-fullscreen',on);document.body.classList.toggle('map-lock',on);
    setSheetCollapsed(false);el('mapSheetToggle').hidden=!on;
    el('mapFullscreen').setAttribute('aria-label',on?'Sumažinti žemėlapį':'Visas ekranas');
    el('mapFullscreen').title=on?'Sumažinti žemėlapį':'Visas ekranas';
    el('mapFullscreen').querySelector('path').setAttribute('d',on?'M4 9h5V4m6 0v5h5M9 20v-5H4m16 0h-5v5':'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5');
    el('mapFullscreen').setAttribute('aria-pressed',String(on));
    if(!panel.hidden)requestAnimationFrame(render);
  }
  el('mapFullscreen').addEventListener('click',()=>fullscreen(!panel.classList.contains('map-fullscreen')));
  el('mapDone').addEventListener('click',()=>{closeMap();el('incidentMapOpen').focus({preventScroll:true});});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('map-fullscreen')){e.preventDefault();fullscreen(false);}});
  el('incidentLocationClear').addEventListener('click',()=>{input.value='';reset();});

  const local=e=>{const r=map.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
  const pair=()=>{const [a,b]=[...pointers.values()];return {mid:[(a[0]+b[0])/2,(a[1]+b[1])/2],distance:Math.max(1,Math.hypot(a[0]-b[0],a[1]-b[1]))};};
  function startPinch(){
    const {mid,distance}=pair(),[cx,cy]=project(...center,zoom);
    pinch={mid,distance,anchor:unproject(cx+mid[0]-map.clientWidth/2,cy+mid[1]-map.clientHeight/2,zoom),scale:1,last:mid};
    drag=null;gestureConsumed=true;shift();
  }
  map.addEventListener('pointerdown',e=>{
    if(e.button!==0||pointers.size>=2)return;
    pointers.set(e.pointerId,local(e));map.setPointerCapture(e.pointerId);
    if(pointers.size===2){startPinch();return;}
    gestureConsumed=false;drag={id:e.pointerId,x:e.clientX,y:e.clientY};
  });
  map.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;
    pointers.set(e.pointerId,local(e));
    if(pinch&&pointers.size===2){
      const {mid,distance}=pair();pinch.scale=clamp(distance/pinch.distance,2**(3-zoom),2**(19-zoom));pinch.last=mid;
      shift(mid[0]-pinch.mid[0],mid[1]-pinch.mid[1],pinch.scale,pinch.mid);return;
    }
    if(!drag||drag.id!==e.pointerId)return;
    shift(e.clientX-drag.x,e.clientY-drag.y);
  });
  function release(e,cancelled){
    if(!pointers.has(e.pointerId))return;
    pointers.delete(e.pointerId);
    if(pinch){
      const p=pinch;pinch=null;
      if(!cancelled){
        zoom=clamp(Math.round(zoom+Math.log2(p.scale)),3,19);
        const [x,y]=project(...p.anchor,zoom);
        center=unproject(x-p.last[0]+map.clientWidth/2,y-p.last[1]+map.clientHeight/2,zoom);
      }
      shift();render();return;
    }
    if(gestureConsumed){if(!pointers.size)gestureConsumed=false;return;}
    if(!drag||drag.id!==e.pointerId)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag=null;shift();
    if(cancelled){render();return;}
    const [cx,cy]=project(...center,zoom);
    if(Math.hypot(dx,dy)>8){center=unproject(cx-dx,cy-dy,zoom);render();}
    else{const r=map.getBoundingClientRect();choose(unproject(cx+e.clientX-r.left-r.width/2,cy+e.clientY-r.top-r.height/2,zoom));}
  }
  map.addEventListener('pointerup',e=>release(e,false));
  map.addEventListener('pointercancel',e=>release(e,true));
  map.addEventListener('lostpointercapture',e=>release(e,true));
  map.addEventListener('keydown',e=>{
    const delta={ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,-80],ArrowDown:[0,80]}[e.key];
    if(delta){e.preventDefault();const [x,y]=project(...center,zoom);center=unproject(x+delta[0],y+delta[1],zoom);render();}
    else if(['+','=','-'].includes(e.key)){e.preventDefault();zoom=clamp(zoom+(e.key==='-'?-1:1),3,19);render();}
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(center);}
  });
  map.addEventListener('wheel',e=>{if(document.activeElement!==map&&!e.ctrlKey)return;e.preventDefault();zoom=clamp(zoom+(e.deltaY<0?1:-1),3,19);render();},{passive:false});
  window.addEventListener('resize',render);
  return {reset,sync,stop,getExtra:()=>extras.map(p=>[...p])};
};

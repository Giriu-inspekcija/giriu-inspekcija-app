'use strict';
// GPS stays in memory until the user explicitly selects a non-sensitive test location.
// Map tiles are requested only on explicit map opening; never automatically on GPS acquisition.
window.giIncidentLocation=function(){
  const el=id=>document.getElementById(id), map=el('incidentMap'), tiles=el('mapTiles'), pin=el('mapPin'),
    input=el('incidentCoords'), panel=el('incidentMapPanel'), gps=el('incidentGps'), gpsStatus=el('incidentGpsStatus'),
    status=el('incidentMapStatus'),gpsDot=el('mapGpsDot'),gpsCircle=el('mapGpsCircle'),useGps=el('incidentUseGps');
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
    const nodes=[];
    for(let y=Math.floor(top/256);y<=Math.floor((top+h-1)/256);y++){
      if(y<0||y>=n)continue;
      for(let x=Math.floor(left/256);x<=Math.floor((left+w-1)/256);x++){
        const img=document.createElement('img');img.alt='';img.draggable=false;
        img.style.left=(x*256-left)+'px';img.style.top=(y*256-top)+'px';
        img.referrerPolicy='strict-origin-when-cross-origin';
        img.src='https://tile.openstreetmap.org/'+zoom+'/'+wrap(x,n)+'/'+y+'.png';
        img.addEventListener('error',()=>{if(img.isConnected)status.textContent='Žemėlapio vaizdas nepasiekiamas. Koordinates galima įvesti ranka.';},{once:true});
        nodes.push(img);
      }
    }
    tiles.replaceChildren(...nodes);
    function position(node,p){
      const [px,py]=project(...p,zoom),dx=wrap(px-cx+world(zoom)/2,world(zoom))-world(zoom)/2;
      node.style.left=(w/2+dx)+'px';node.style.top=(h/2+py-cy)+'px';node.hidden=false;
    }
    if(selected)position(pin,selected);else pin.hidden=true;
    if(best){
      position(gpsDot,best.point);position(gpsCircle,best.point);
      const metresPerPixel=40075016.686*Math.cos(clamp(best.point[0],-maxLat,maxLat)*Math.PI/180)/world(zoom);
      const diameter=clamp(2*best.accuracy/metresPerPixel,10,100000);
      gpsCircle.style.width=gpsCircle.style.height=diameter+'px';
    }else{gpsDot.hidden=true;gpsCircle.hidden=true;}
    el('mapZoomOut').disabled=zoom<=3;el('mapZoomIn').disabled=zoom>=17;
  }
  function choose(p){
    selected=p;input.value=format(p);
    if(best)gpsStatus.textContent='GPS tikslumas ±'+Math.ceil(best.accuracy)+' m. Įvykiui pasirinktas žemėlapio taškas.';
    status.textContent='Įvykiui pasirinkta: '+input.value;
    render();
  }
  function sync(){
    selected=parse(input.value);
    if(selected){center=[...selected];zoom=16;status.textContent='Įvykiui pasirinkta: '+format(selected);}
    else status.textContent='Įvykiui vieta dar nepasirinkta.';
    render();
  }
  function closeMap(){
    panel.hidden=true;tiles.replaceChildren();pin.hidden=true;gpsDot.hidden=true;gpsCircle.hidden=true;
    el('incidentMapOpen').textContent='Žemėlapis';
  }
  function stop(){
    generation++;searching=false;
    if(timer!==null){clearTimeout(timer);timer=null;}
    if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null;}
    gps.disabled=false;gps.textContent='◎ Nustatyti GPS';
  }
  function reset(){
    stop();best=null;useGps.hidden=true;
    gpsStatus.textContent='Nustatykite vietą arba pasirinkite tašką žemėlapyje.';
    selected=null;center=[55.2,24.0];zoom=8;drag=null;status.textContent='';closeMap();
  }
  function showFix(){
    if(!best)return;
    const accuracy=Math.ceil(best.accuracy);
    gpsStatus.textContent=(searching?'Tikslinama… ':'GPS nustatyta. ')+'Tikslumas ±'+accuracy+' m.'
      +(accuracy>25?' Vieta apytikslė – patikrinkite žemėlapyje.':'')
      +' GPS taškas dar neišsaugotas.';
    useGps.hidden=false;
  }
  gps.addEventListener('click',()=>{
    if(!navigator.geolocation){gpsStatus.textContent='GPS nepalaikomas. Galite naudoti žemėlapį arba rankines koordinates.';return;}
    stop();best=null;useGps.hidden=true;const token=generation;searching=true;
    gps.disabled=true;gps.textContent='Tikslinama…';
    gpsStatus.textContent='Ieškoma vietos. Jei prašoma, suteikite vietos leidimą.';
    function finish(message){
      if(token!==generation)return;
      stop();
      if(best)showFix();else gpsStatus.textContent=message;
    }
    const receive=({coords})=>{
      if(token!==generation)return;
      const {latitude,longitude,accuracy}=coords;
      if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||!Number.isFinite(accuracy)||accuracy<=0||Math.abs(latitude)>90||Math.abs(longitude)>180)return;
      if(!best||accuracy<best.accuracy){best={point:[latitude,longitude],accuracy};showFix();
        if(!panel.hidden){center=[...best.point];zoom=16;render();}}
      if(best.accuracy<=15)finish('');
    };
    const fail=error=>{if(token!==generation)return;if(error.code===1||!best)finish(({1:'Vietos leidimas nesuteiktas. Patikrinkite tikslios vietos leidimą.',2:'GPS vieta nepasiekiama. Bandykite atviroje vietoje.',3:'GPS paieškos laikas baigėsi. Bandykite dar kartą.'}[error.code]||'Nepavyko nustatyti vietos.')+' Galima pasirinkti tašką ranka.');};
    try{
      timer=setTimeout(()=>finish('GPS vietos nustatyti nepavyko. Bandykite dar kartą.'),20000);
      const id=navigator.geolocation.watchPosition(receive,fail,{enableHighAccuracy:true,timeout:20000,maximumAge:0});
      if(token===generation)watch=id;else navigator.geolocation.clearWatch(id);
    }catch{finish('Vietos nustatyti nepavyko. Patikrinkite leidimus.');}
  });
  function openMapAt(p){
    panel.hidden=false;el('incidentMapOpen').textContent='Uždaryti žemėlapį';
    if(p){center=[...p];zoom=16;}render();
  }
  useGps.addEventListener('click',()=>{
    if(!best)return;
    // Explicit non-sensitive test-location selection, not background location tracking.
    stop();choose([...best.point]);gpsStatus.textContent='GPS pasirinkta įvykiui · tikslumas ±'+Math.ceil(best.accuracy)+' m. Bus išsaugota pateikus įvykį.';
    if(!panel.hidden)openMapAt(best.point);
  });
  el('incidentMapOpen').addEventListener('click',()=>{
    if(!panel.hidden){closeMap();return;}
    selected=parse(input.value);
    openMapAt(best?.point||selected);
    status.textContent=selected?'Įvykiui pasirinkta: '+format(selected):'Įvykiui vieta dar nepasirinkta.';
  });
  el('mapMyLocation').addEventListener('click',()=>{
    if(best)openMapAt(best.point);else gps.click();
  });
  input.addEventListener('change',sync);
  el('incidentLocationClear').addEventListener('click',()=>{input.value='';reset();});
  el('mapZoomIn').addEventListener('click',()=>{zoom=clamp(zoom+1,3,17);render();});
  el('mapZoomOut').addEventListener('click',()=>{zoom=clamp(zoom-1,3,17);render();});
  el('mapCenter').addEventListener('click',()=>choose(center));
  map.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};map.setPointerCapture(e.pointerId);
  });
  map.addEventListener('pointercancel',()=>{drag=null;});
  map.addEventListener('pointerup',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag=null;
    const [cx,cy]=project(...center,zoom);
    if(Math.hypot(dx,dy)>8){center=unproject(cx-dx,cy-dy,zoom);render();}
    else{const r=map.getBoundingClientRect();choose(unproject(cx+e.clientX-r.left-r.width/2,cy+e.clientY-r.top-r.height/2,zoom));}
  });
  map.addEventListener('keydown',e=>{
    const delta={ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,-80],ArrowDown:[0,80]}[e.key];
    if(delta){e.preventDefault();const [x,y]=project(...center,zoom);center=unproject(x+delta[0],y+delta[1],zoom);render();}
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(center);}
  });
  window.addEventListener('resize',render);
  return {reset,sync,stop};
};

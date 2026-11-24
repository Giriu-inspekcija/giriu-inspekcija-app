'use strict';
// GPS is deliberately kept separate from the synthetic incident coordinate field.
// No GPS position is sent to the database, map tile provider, or browser storage.
window.giIncidentLocation=function(){
  const el=id=>document.getElementById(id), map=el('incidentMap'), tiles=el('mapTiles'), pin=el('mapPin'),
    input=el('incidentCoords'), panel=el('incidentMapPanel'), gps=el('incidentGps'), gpsStatus=el('incidentGpsStatus'),
    status=el('incidentMapStatus');
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
    if(selected){
      const [px,py]=project(...selected,zoom),dx=wrap(px-cx+world(zoom)/2,world(zoom))-world(zoom)/2;
      pin.style.left=(w/2+dx)+'px';pin.style.top=(h/2+py-cy)+'px';pin.hidden=false;
    }else pin.hidden=true;
    el('mapZoomOut').disabled=zoom<=3;el('mapZoomIn').disabled=zoom>=17;
  }
  function choose(p){
    selected=p;input.value=format(p);
    status.textContent='Pasirinkta bandomoji vieta: '+input.value;
    render();
  }
  function sync(){
    selected=parse(input.value);
    if(selected){center=[...selected];zoom=12;status.textContent='Pasirinkta bandomoji vieta: '+format(selected);}
    else status.textContent='Pasirinkite išgalvotą vietą.';
    render();
  }
  function closeMap(){
    panel.hidden=true;tiles.replaceChildren();pin.hidden=true;
    el('incidentMapOpen').textContent='Žemėlapis';
  }
  function reset(){
    generation++;gps.disabled=false;gps.textContent='◎ Nustatyti GPS';
    gpsStatus.textContent='GPS patikra: tik jūsų telefone, į bandomą įvykį neįrašoma.';
    selected=null;center=[55.2,24.0];zoom=8;drag=null;status.textContent='';closeMap();
  }
  gps.addEventListener('click',()=>{
    if(!navigator.geolocation){gpsStatus.textContent='GPS nepalaikomas. Galite naudoti žemėlapį arba rankines koordinates.';return;}
    const token=++generation;gps.disabled=true;gps.textContent='Nustatoma…';
    gpsStatus.textContent='Ieškoma vietos. Jei prašoma, suteikite vietos leidimą.';
    const finish=message=>{if(token!==generation)return;gps.disabled=false;gps.textContent='◎ Nustatyti GPS';gpsStatus.textContent=message;};
    try{
      navigator.geolocation.getCurrentPosition(({coords})=>{
        if(!Number.isFinite(coords.latitude)||!Number.isFinite(coords.longitude)){finish('GPS nepateikė tinkamos vietos.');return;}
        finish('GPS: '+format([coords.latitude,coords.longitude])+' · tikslumas ±'+Math.round(coords.accuracy)+' m. Tik jūsų telefone; į įvykį neįrašoma.');
      },error=>finish(({1:'Vietos leidimas nesuteiktas. Patikrinkite telefono naršyklės vietos leidimus.',2:'GPS vieta nepasiekiama. Bandykite atviroje vietoje.',3:'GPS paieškos laikas baigėsi. Bandykite dar kartą.'}[error.code]||'Nepavyko nustatyti vietos.')+' Galima įvesti koordinates ranka.'),{enableHighAccuracy:true,timeout:20000,maximumAge:0});
    }catch{finish('Vietos nustatyti nepavyko. Patikrinkite leidimus.');}
  });
  el('incidentMapOpen').addEventListener('click',()=>{
    if(!panel.hidden){closeMap();return;}
    // Opening the map is an explicit request; the GPS fix is never used here.
    panel.hidden=false;el('incidentMapOpen').textContent='Uždaryti žemėlapį';sync();
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
  return {reset,sync};
};

// Cache only public PWA shell. NEVER cache Supabase requests, user data or auth tokens.
const CACHE='gi-pilot-shell-20261123-v32-location-details-incident-delegation-history-refresh';
const ASSETS=['./','./index.html','./app.js','./team-thread.js','./incident-location.js','./deadlines.js','./document-export.js','./vendor/fflate-0.8.2.js','./manifest.webmanifest','../logo.png','../icon-192.png','../icon-512.png','../icon-192-maskable.png','../icon-512-maskable.png','../apple-touch-icon.png','../favicon-64.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('gi-pilot-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'&&url.pathname.includes('/pilot/')){
    event.respondWith(fetch(request).catch(()=>caches.match('./index.html')));
    return;
  }
  if(!ASSETS.some(path=>new URL(path,self.registration.scope).pathname===url.pathname))return;
  // Network first: a freshly deployed app.js must not stay stale in installed PWA.
  // Keep only this public shell in the cache; authenticated API traffic bypasses the SW.
  event.respondWith(fetch(request).then(response=>{
    if(response.ok){
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));
    }
    return response;
  }).catch(()=>caches.match(request)));
});

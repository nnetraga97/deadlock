'use strict';
const CACHE='deadlock-guide-2026-10-31-v6';
const FILES=[
  './','index.html','styles.css','compact-ui.css','app.js','field-guide.js','match-clock.js',
  'manifest.webmanifest','assets/map-base.webp','assets/map-data.json',
  'assets/guide-data.json','assets/attack-data.json','assets/routes-data.json','assets/route-lessons.json',
  'assets/icon.svg','assets/icon-192.png','assets/icon-512.png'
];
const ASSETS=new Map(FILES.map(file=>{
  const url=new URL(file,self.registration.scope);
  return [url.pathname,url.href];
}));
const HOME=new URL('./',self.registration.scope);
const INDEX=new URL('index.html',self.registration.scope);

self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.all([...ASSETS.values()].map(async url=>{
    try{
      const response=await fetch(new Request(url,{cache:'reload'}));
      if(response.ok&&!response.redirected)await cache.put(url,response);
    }catch{}
  }));
  await self.skipWaiting();
})()));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys()){
    if(key.startsWith('deadlock-guide-')&&key!==CACHE)await caches.delete(key);
  }
  await self.clients.claim();
})()));

async function networkFirst(request,key,fallbackKey){
  try{
    // Revalidate the browser's HTTP cache as well as bypassing Cache Storage.
    const response=await fetch(request,{cache:'no-cache'});
    if(response.ok&&!response.redirected){
      try{
        const cache=await caches.open(CACHE);
        await cache.put(key,response.clone());
      }catch{}
    }
    return response;
  }catch{
    try{
      const cache=await caches.open(CACHE);
      return (await cache.match(key))||(fallbackKey&&await cache.match(fallbackKey))||Response.error();
    }catch{return Response.error();}
  }
}

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'){
    if(url.pathname!==HOME.pathname&&url.pathname!==INDEX.pathname)return;
    event.respondWith(networkFirst(event.request,INDEX.href,HOME.href));
    return;
  }
  const key=ASSETS.get(url.pathname);
  if(!key)return;
  // Versioned script URLs share only this release's canonical fallback entry.
  event.respondWith(networkFirst(event.request,key));
});

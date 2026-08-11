const CACHE="focus-lab-ops-shell-v2";
const SHELL=["/index.html","/manifest.webmanifest","/focus-lab-mark.svg"];
self.addEventListener("install",(event)=>event.waitUntil(caches.open(CACHE).then((cache)=>cache.addAll(SHELL))));
self.addEventListener("activate",(event)=>event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE).map((key)=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",(event)=>{
  const request=event.request;if(request.method!=="GET")return;
  const url=new URL(request.url);if(url.origin!==self.location.origin||url.pathname.startsWith("/v1/")||url.pathname.startsWith("/cdn-cgi/access/"))return;
  if(request.mode==="navigate"){
    event.respondWith(fetch(request,{cache:"no-store"}).catch(()=>caches.match("/index.html").then((response)=>response??Response.error())));return;
  }
  const isShellAsset=SHELL.includes(url.pathname)||url.pathname.startsWith("/assets/");if(!isShellAsset)return;
  event.respondWith(caches.match(request).then((cached)=>cached??fetch(request).then((response)=>{if(!response.ok||response.type!=="basic")return response;const copy=response.clone();event.waitUntil(caches.open(CACHE).then((cache)=>cache.put(request,copy)));return response;})));
});

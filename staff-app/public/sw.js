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

// Future push providers may send only a non-PII event type and conversation ID.
self.addEventListener("push",(event)=>{let data={};try{data=event.data?.json()??{};}catch{}const isNew=data.type==="conversation:new";event.waitUntil(self.registration.showNotification(isNew?"New Focus Lab website chat":"New Focus Lab chat message",{body:isNew?"Open Operations to review the new conversation.":"Open Operations to read the new message.",icon:"/focus-lab-mark.svg",badge:"/focus-lab-mark.svg",tag:`focuslab-chat-${data.conversationId??"inbox"}`,data:{url:data.conversationId?`/#/chat?conversation=${encodeURIComponent(data.conversationId)}`:"/#/chat"}}));});
self.addEventListener("notificationclick",(event)=>{event.notification.close();const target=event.notification.data?.url??"/#/chat";event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then((clients)=>{const existing=clients[0];if(existing){existing.navigate(target);return existing.focus();}return self.clients.openWindow(target);}));});

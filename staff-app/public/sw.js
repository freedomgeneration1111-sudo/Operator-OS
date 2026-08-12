const VERSION="focus-lab-ops-sw-v4";
const CACHE="focus-lab-ops-shell-v4";
const SHELL=["/index.html","/manifest.webmanifest","/focus-lab-mark.svg"];
self.addEventListener("install",(event)=>event.waitUntil(caches.open(CACHE).then((cache)=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",(event)=>event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE).map((key)=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("message",(event)=>{if(event.data?.type==="focuslab:push-diagnostics")event.ports[0]?.postMessage({version:VERSION});});
self.addEventListener("fetch",(event)=>{
  const request=event.request;if(request.method!=="GET")return;
  const url=new URL(request.url);if(url.origin!==self.location.origin||url.pathname.startsWith("/v1/")||url.pathname.startsWith("/cdn-cgi/access/"))return;
  if(request.mode==="navigate"){
    event.respondWith(fetch(request,{cache:"no-store"}).catch(()=>caches.match("/index.html").then((response)=>response??Response.error())));return;
  }
  const isShellAsset=SHELL.includes(url.pathname)||url.pathname.startsWith("/assets/");if(!isShellAsset)return;
  event.respondWith(caches.match(request).then((cached)=>cached??fetch(request).then((response)=>{if(!response.ok||response.type!=="basic")return response;const copy=response.clone();event.waitUntil(caches.open(CACHE).then((cache)=>cache.put(request,copy)));return response;})));
});

self.addEventListener("push",(event)=>{
  let data={};try{data=event.data?.json()??{};}catch{/* A safe fallback notification is still shown. */}
  const title=typeof data.title==="string"?data.title:"New Focus Lab message";
  const body=typeof data.body==="string"?data.body:"Open Operations to respond.";
  const conversationId=typeof data.conversationId==="string"?data.conversationId:null;
  const url=typeof data.url==="string"&&data.url.startsWith("/#/")?data.url:conversationId?`/#/chat?conversation=${encodeURIComponent(conversationId)}`:"/#/chat";
  const badge=Number.isInteger(data.badge)&&data.badge>=0?data.badge:null;
  event.waitUntil(Promise.all([
    self.registration.showNotification(title,{body,icon:"/focus-lab-mark.svg",badge:"/focus-lab-mark.svg",tag:`focuslab-chat-${conversationId??"inbox"}`,data:{url}}),
    updateBadge(badge),
  ]));
});
self.addEventListener("notificationclick",(event)=>{
  event.notification.close();const target=event.notification.data?.url??"/#/chat";
  event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(async(clients)=>{
    const existing=clients.find((client)=>"focus" in client);if(existing){await existing.navigate(target);return existing.focus();}
    return self.clients.openWindow(target);
  }));
});
function updateBadge(count){try{if(count===null)return Promise.resolve();if(count>0&&typeof self.navigator?.setAppBadge==="function")return self.navigator.setAppBadge(count);if(count===0&&typeof self.navigator?.clearAppBadge==="function")return self.navigator.clearAppBadge();}catch{/* Badging is optional. */}return Promise.resolve();}

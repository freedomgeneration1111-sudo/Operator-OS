import { useCallback,useEffect,useState } from "react";
import type { OperationsClient } from "./api";
import { businessProfile,serviceWorkerVersion as expectedVersion } from "./business-profile";

const EXPECTED_SERVICE_WORKER_VERSION=expectedVersion(businessProfile);
export type PushNotificationState="checking"|"available"|"enabled"|"blocked"|"unsupported"|"error";
export type PushDiagnostics={
  secureContext:boolean;serviceWorkerApi:boolean;pushManagerApi:boolean;notificationApi:boolean;
  permission:NotificationPermission|"unavailable";registrationActive:boolean;serviceWorkerControlled:boolean;
  serviceWorkerVersion:string|null;registrationPushManager:boolean;pushSubscription:boolean;
  vapidConfigured:boolean|null;serverRegistration:"not attempted"|"active"|"failed";
  d1Registered:boolean|null;d1SubscriptionCount:number|null;activeUntil:string|null;
  lastSuccessfulDelivery:string|null;lastDeliveryFailure:string|null;lastChecked:string;errorStage:string|null;
};
export type PushNotificationController={
  state:PushNotificationState;message:string;busy:boolean;diagnostics:PushDiagnostics;lastTest:string;
  enable():Promise<void>;disable():Promise<void>;test():Promise<void>;refresh():Promise<void>;
};
type PushConfig={ok:true;configured:boolean;publicKey:string|null;subscriptionCount:number};

function baseDiagnostics():PushDiagnostics{
  const notificationApi=typeof window!=="undefined"&&"Notification" in window;
  return{
    secureContext:typeof window!=="undefined"&&window.isSecureContext===true,
    serviceWorkerApi:typeof navigator!=="undefined"&&"serviceWorker" in navigator,
    pushManagerApi:typeof window!=="undefined"&&"PushManager" in window,
    notificationApi,
    permission:notificationApi?Notification.permission:"unavailable",
    registrationActive:false,serviceWorkerControlled:false,serviceWorkerVersion:null,registrationPushManager:false,
    pushSubscription:false,vapidConfigured:null,serverRegistration:"not attempted",d1Registered:null,
    d1SubscriptionCount:null,activeUntil:null,lastSuccessfulDelivery:null,lastDeliveryFailure:null,
    lastChecked:new Date().toISOString(),errorStage:null,
  };
}

export function supportsStaffPush(){
  const diagnostics=baseDiagnostics();
  return Boolean(diagnostics.secureContext&&diagnostics.notificationApi&&diagnostics.serviceWorkerApi&&diagnostics.pushManagerApi);
}

export function isStaffPageForeground(documentValue:Pick<Document,"visibilityState"|"hasFocus">=document){
  return documentValue.visibilityState==="visible"&&documentValue.hasFocus();
}

export function usePushNotifications(client:OperationsClient):PushNotificationController{
  const [state,setState]=useState<PushNotificationState>("checking");
  const [message,setMessage]=useState("Checking notification support…");
  const [busy,setBusy]=useState(false);
  const [config,setConfig]=useState<PushConfig|null>(null);
  const [diagnostics,setDiagnostics]=useState<PushDiagnostics>(baseDiagnostics);
  const [lastTest,setLastTest]=useState("Not run");

  const inspect=useCallback(async()=>{
    const next=baseDiagnostics();setState("checking");setMessage("Checking notification support…");
    try{
      next.errorStage="VAPID configuration";
      const pushConfig=await client.pushConfig();setConfig(pushConfig);
      next.vapidConfigured=pushConfig.configured&&Boolean(pushConfig.publicKey);
      next.d1SubscriptionCount=pushConfig.subscriptionCount;
      if(!supportsStaffPush()){
        next.errorStage=null;setDiagnostics(next);setState("unsupported");
        setMessage(!next.secureContext?"Notifications require a secure HTTPS connection.":"This browser or app does not expose all required Web Push APIs.");
        return;
      }
      next.errorStage="service worker";
      const registration=await navigator.serviceWorker.getRegistration();
      next.registrationActive=Boolean(registration?.active);
      next.serviceWorkerControlled=Boolean(navigator.serviceWorker.controller);
      next.registrationPushManager=Boolean(registration?.pushManager);
      if(!registration?.active||!registration.pushManager){
        setDiagnostics(next);setState("error");setMessage("The notification service worker is not active. Reload Operations, then check again.");return;
      }
      next.serviceWorkerVersion=await serviceWorkerVersion(registration.active);
      if(next.serviceWorkerVersion&&next.serviceWorkerVersion!==EXPECTED_SERVICE_WORKER_VERSION){
        next.errorStage="stale service worker";setDiagnostics(next);setState("error");
        setMessage("The notification service worker is out of date. Close and reopen Operations, then check again.");return;
      }
      next.errorStage="PushSubscription";
      const subscription=await registration.pushManager.getSubscription();
      next.pushSubscription=Boolean(subscription);
      if(subscription){
        next.errorStage="subscription registration";
        try{await client.registerPush(subscription.toJSON());next.serverRegistration="active";}
        catch(error){next.serverRegistration="failed";throw error;}
        next.errorStage="D1 subscription status";
        const server=await client.pushStatus(subscription.endpoint);
        next.d1Registered=server.registered&&server.enabled;next.activeUntil=server.activeUntil;
        next.lastSuccessfulDelivery=server.lastSuccessAt;
        next.lastDeliveryFailure=server.lastFailureAt?server.lastFailureAt+(server.lastFailureCode?" ("+server.lastFailureCode+")":""):null;
      }
      next.permission=Notification.permission;next.errorStage=null;next.lastChecked=new Date().toISOString();setDiagnostics(next);
      if(Notification.permission==="denied"){setState("blocked");setMessage("Notifications are blocked by this device or browser. Enable them in browser or system settings.");}
      else if(subscription&&next.d1Registered){setState("enabled");setMessage("This device will receive customer alerts.");}
      else if(!next.vapidConfigured){setState("error");setMessage("Notifications are not configured for this environment.");}
      else{setState("available");setMessage(Notification.permission==="granted"?"Permission is granted, but this device is not subscribed. Enable notifications to repair it.":`Get notified when customers message ${businessProfile.shortName}.`);}
    }catch(error){
      next.lastChecked=new Date().toISOString();setDiagnostics({...next});
      setState("error");setMessage("Notification setup failed during "+(next.errorStage??"status check")+": "+(error instanceof Error?error.message:"unknown error"));
    }
  },[client]);

  useEffect(()=>{void inspect();},[inspect]);

  async function enable(){
    if(!supportsStaffPush())return void await inspect();setBusy(true);
    try{
      const permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;
      if(permission!=="granted"){await inspect();return;}
      const current=config??await client.pushConfig();setConfig(current);
      if(!current.configured||!current.publicKey)throw new Error("VAPID configuration is unavailable");
      const registration=await navigator.serviceWorker.ready;
      if(!registration.pushManager)throw new Error("PushManager is unavailable on the active service worker");
      const existing=await registration.pushManager.getSubscription();
      const subscription=existing??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64Key(current.publicKey)});
      await client.registerPush(subscription.toJSON());
      await client.pushActivity(subscription.endpoint,isStaffPageForeground());
      window.dispatchEvent(new Event("operator:push-subscription-change"));
      await inspect();
    }catch(error){
      setState("error");setMessage("Subscription failed: "+(error instanceof Error?error.message:"unknown error"));
      setDiagnostics((value)=>({...value,serverRegistration:"failed",errorStage:"subscription registration",lastChecked:new Date().toISOString()}));
    }finally{setBusy(false);}
  }

  async function disable(){
    setBusy(true);
    try{
      const registration=await navigator.serviceWorker.getRegistration();
      const subscription=await registration?.pushManager.getSubscription();
      if(subscription){await client.removePush(subscription.endpoint);await subscription.unsubscribe();}
      window.dispatchEvent(new Event("operator:push-subscription-change"));await inspect();
    }catch(error){setState("error");setMessage("Notifications could not be disabled: "+(error instanceof Error?error.message:"unknown error"));}
    finally{setBusy(false);}
  }

  async function test(){
    setBusy(true);setLastTest("Sending…");
    try{
      const registration=await navigator.serviceWorker.getRegistration();
      const subscription=await registration?.pushManager.getSubscription();
      if(!subscription)throw new Error("No active PushSubscription");
      const result=await client.testPush(subscription.endpoint);
      const time=new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit",second:"2-digit"}).format(new Date(result.deliveredAt));
      setLastTest("Delivered "+time);await inspect();
    }catch(error){setLastTest("Failed — "+(error instanceof Error?error.message:"unknown error"));}
    finally{setBusy(false);}
  }

  return{state,message,busy,diagnostics,lastTest,enable,disable,test,refresh:inspect};
}

export function usePushActivity(client:OperationsClient){
  useEffect(()=>{
    let stopped=false;
    const sync=async(foreground=isStaffPageForeground())=>{
      if(!supportsStaffPush()||stopped)return;
      try{
        const registration=await navigator.serviceWorker.getRegistration();
        const subscription=await registration?.pushManager.getSubscription();
        if(subscription)await client.pushActivity(subscription.endpoint,foreground);
      }catch{/* Push activity is best-effort; D1 unread state remains authoritative. */}
    };
    const update=()=>{void sync();};
    const background=()=>{void sync(false);};
    void sync();document.addEventListener("visibilitychange",update);window.addEventListener("focus",update);
    window.addEventListener("blur",background);window.addEventListener("pagehide",background);
    window.addEventListener("operator:push-subscription-change",update);
    const timer=window.setInterval(()=>{if(isStaffPageForeground())void sync(true);},30_000);
    return()=>{stopped=true;window.clearInterval(timer);document.removeEventListener("visibilitychange",update);
      window.removeEventListener("focus",update);window.removeEventListener("blur",background);
      window.removeEventListener("pagehide",background);window.removeEventListener("operator:push-subscription-change",update);};
  },[client]);
}

export function syncAppBadge(unreadConversations:number){const badgeNavigator=navigator as Navigator&{setAppBadge?:(count?:number)=>Promise<void>;clearAppBadge?:()=>Promise<void>};try{const result=unreadConversations>0?badgeNavigator.setAppBadge?.(unreadConversations):badgeNavigator.clearAppBadge?.();void result?.catch(()=>{});}catch{/* Badging is optional. */}}
function base64Key(value:string){const padding="=".repeat((4-value.length%4)%4);const bytes=atob((value+padding).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from(bytes,(character)=>character.charCodeAt(0));}
function serviceWorkerVersion(worker:ServiceWorker){return new Promise<string|null>((resolve)=>{const channel=new MessageChannel();const timer=window.setTimeout(()=>resolve(null),1_500);channel.port1.onmessage=(event)=>{window.clearTimeout(timer);resolve(typeof event.data?.version==="string"?event.data.version:null);};worker.postMessage({type:"operator:push-diagnostics"},[channel.port2]);});}

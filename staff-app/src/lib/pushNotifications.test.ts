import { afterEach,describe,expect,it } from "vitest";
import { isStaffPageForeground,supportsStaffPush } from "./pushNotifications";

const originalServiceWorker=Object.getOwnPropertyDescriptor(navigator,"serviceWorker");
const originalNotification=Object.getOwnPropertyDescriptor(window,"Notification");
const originalPushManager=Object.getOwnPropertyDescriptor(window,"PushManager");
const originalSecureContext=Object.getOwnPropertyDescriptor(window,"isSecureContext");
afterEach(()=>{restore(navigator,"serviceWorker",originalServiceWorker);restore(window,"Notification",originalNotification);restore(window,"PushManager",originalPushManager);restore(window,"isSecureContext",originalSecureContext);});
describe("staff push feature detection",()=>{
  it("reports unsupported unless every standards API is available",()=>{Object.defineProperty(window,"Notification",{configurable:true,value:function Notification(){}});Object.defineProperty(window,"PushManager",{configurable:true,value:function PushManager(){}});Reflect.deleteProperty(navigator,"serviceWorker");expect(supportsStaffPush()).toBe(false);});
  it("reports available only in a secure context with all standards APIs",()=>{Object.defineProperty(window,"isSecureContext",{configurable:true,value:true});Object.defineProperty(window,"Notification",{configurable:true,value:function Notification(){}});Object.defineProperty(window,"PushManager",{configurable:true,value:function PushManager(){}});Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{}});expect(supportsStaffPush()).toBe(true);Object.defineProperty(window,"isSecureContext",{configurable:true,value:false});expect(supportsStaffPush()).toBe(false);});
  it("classifies only a visible focused document as foreground",()=>{expect(isStaffPageForeground({visibilityState:"visible",hasFocus:()=>true})).toBe(true);expect(isStaffPageForeground({visibilityState:"hidden",hasFocus:()=>true})).toBe(false);expect(isStaffPageForeground({visibilityState:"visible",hasFocus:()=>false})).toBe(false);});
});
function restore(target:object,key:string,descriptor:PropertyDescriptor|undefined){if(descriptor)Object.defineProperty(target,key,descriptor);else delete (target as Record<string,unknown>)[key];}

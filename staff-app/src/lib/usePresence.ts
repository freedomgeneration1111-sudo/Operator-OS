import { useCallback,useEffect,useRef,useState } from "react";
import { HeartbeatController,type HeartbeatState } from "./heartbeat";
import type { OperationsClient } from "./api";
import { businessProfile } from "./business-profile";

export function usePresence(client:OperationsClient,responderId:string,timeoutSeconds:number,onChanged:()=>void){
  const key=`operator-os-${businessProfile.key}-live-${responderId}`;
  const [enabled,setEnabled]=useState(()=>sessionStorage.getItem(key)==="true");
  const [state,setState]=useState<HeartbeatState>(enabled?"starting":"off");
  const [message,setMessage]=useState<string>();
  const callbackRef=useRef(onChanged);callbackRef.current=onChanged;
  const controllerRef=useRef<HeartbeatController|undefined>(undefined);
  useEffect(()=>{
    const controller=new HeartbeatController(
      async(available)=>{await client.heartbeat(available);callbackRef.current();},
      (next,note)=>{setState(next);setMessage(note);},
    );
    controllerRef.current=controller;
    if(enabled)void controller.start(timeoutSeconds);
    const reconnect=()=>{if(enabled)void controller.pulse();};
    const visibility=()=>{if(enabled&&document.visibilityState==="visible")void controller.pulse();};
    window.addEventListener("online",reconnect);document.addEventListener("visibilitychange",visibility);
    return()=>{window.removeEventListener("online",reconnect);document.removeEventListener("visibilitychange",visibility);void controller.stop(true);};
  },[client,responderId,timeoutSeconds,enabled]);
  const toggle=useCallback(async(next:boolean)=>{
    setMessage(undefined);
    if(next){sessionStorage.setItem(key,"true");setEnabled(true);}
    else{sessionStorage.removeItem(key);await controllerRef.current?.stop(true);setEnabled(false);}
  },[key]);
  return { enabled,state,message,toggle };
}

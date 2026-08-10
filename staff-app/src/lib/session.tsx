import { createContext,useContext,useMemo,useState,type ReactNode } from "react";
import { OperationsClient } from "./api";
import type { Responder } from "./types";

type Session={ client:OperationsClient;apiUrl:string;responder:Responder;token:string };
type SessionContextValue={ session:Session|null;developmentAuthAllowed:boolean;login(apiUrl:string,token:string,responder:Responder):void;logout():void };
const SessionContext=createContext<SessionContextValue|null>(null);
const STORAGE_KEY="focus-lab-ops-development-session-v1";

function developmentAllowed(){ return import.meta.env.VITE_AUTH_MODE==="development"&&import.meta.env.VITE_APP_STAGE!=="production"; }
function restore():Session|null{
  if(!developmentAllowed()) return null;
  try{
    const raw=sessionStorage.getItem(STORAGE_KEY);if(!raw)return null;
    const value:unknown=JSON.parse(raw);
    if(!isStoredSession(value))return null;
    return { ...value,client:new OperationsClient(value.apiUrl,value.token) };
  }catch{return null;}
}

export function SessionProvider({ children }:{ children:ReactNode }){
  const [session,setSession]=useState<Session|null>(restore);
  const value=useMemo<SessionContextValue>(()=>({
    session,developmentAuthAllowed:developmentAllowed(),
    login(apiUrl,token,responder){
      const next={ apiUrl:apiUrl.replace(/\/$/,""),token,responder };
      sessionStorage.setItem(STORAGE_KEY,JSON.stringify(next));
      setSession({ ...next,client:new OperationsClient(next.apiUrl,next.token) });
    },
    logout(){ sessionStorage.removeItem(STORAGE_KEY);setSession(null); },
  }),[session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
export function useSession(){ const value=useContext(SessionContext);if(!value)throw new Error("SessionProvider is missing");return value; }
function isStoredSession(value:unknown):value is Omit<Session,"client">{
  if(typeof value!=="object"||!value)return false;
  return "apiUrl" in value&&typeof value.apiUrl==="string"&&"token" in value&&typeof value.token==="string"&&"responder" in value&&isResponder(value.responder);
}
function isResponder(value:unknown):value is Responder{return typeof value==="object"&&value!==null&&"id" in value&&typeof value.id==="string"&&"display_label" in value&&typeof value.display_label==="string";}

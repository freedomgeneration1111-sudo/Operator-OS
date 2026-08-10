import { useEffect,useState } from "react";
export function useOnline(){const [online,setOnline]=useState(navigator.onLine);useEffect(()=>{const yes=()=>setOnline(true);const no=()=>setOnline(false);window.addEventListener("online",yes);window.addEventListener("offline",no);return()=>{window.removeEventListener("online",yes);window.removeEventListener("offline",no);};},[]);return online;}
export function useDebounced<T>(value:T,delay=350){const [debounced,setDebounced]=useState(value);useEffect(()=>{const timer=window.setTimeout(()=>setDebounced(value),delay);return()=>window.clearTimeout(timer);},[value,delay]);return debounced;}
export function useHashRoute(){
  const read=()=>location.hash.slice(1)||"/inbox";const [route,setRoute]=useState(read);
  useEffect(()=>{const update=()=>setRoute(read());window.addEventListener("hashchange",update);return()=>window.removeEventListener("hashchange",update);},[]);
  return route;
}

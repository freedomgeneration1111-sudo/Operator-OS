import type { ReactNode } from "react";
import type { OperationsStatus } from "../lib/types";
import { presencePresentation,type HeartbeatState } from "../lib/heartbeat";
import { useOnline } from "../lib/hooks";
import { businessProfile,navigationFor } from "../lib/business-profile";

export function Shell({ children,route,status,availability,onAvailability,availabilityMessage,responderName,onLogout,canManageWebsite }:{
  children:ReactNode;route:string;status:OperationsStatus|null;availability:{ enabled:boolean;state:HeartbeatState };onAvailability:(next:boolean)=>void;
  availabilityMessage?:string;responderName:string;onLogout:()=>void;canManageWebsite:boolean;
}){
  const online=useOnline();
  const presence=presencePresentation(availability.enabled,availability.state);
  const nav=navigationFor(businessProfile,canManageWebsite);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to Main Content</a>
    <aside className="sidebar"><div className="brand">{businessProfile.logoUrl?<img src={businessProfile.logoUrl} alt="" width="40" height="40"/>:null}<span><strong>{businessProfile.shortName}</strong><small>Operations</small></span></div><nav aria-label="Primary">{nav.map(({href,label})=><a key={href} href={`#${href}`} aria-current={route.startsWith(href)?"page":undefined}>{label}</a>)}</nav><button className="button text logout" onClick={onLogout}>End Development Session</button></aside>
    <div className="workspace"><header className="topbar"><div><p className="eyebrow">Signed in as</p><strong>{responderName}</strong></div><div className="topbar-actions"><span className={`connection ${online?"online":"offline"}`}><span aria-hidden="true">●</span> {online?"Connected":"Offline"}</span><label className={`availability-toggle ${presence.confirmedLive?"is-live":""}`}><input type="checkbox" checked={availability.enabled} onChange={(event)=>onAvailability(event.target.checked)}/><span><strong>{presence.label}</strong><small>{presence.detail}</small></span></label></div></header>
      {!online?<div className="network-banner" role="status">You’re offline. CRM changes are disabled until the connection returns.</div>:null}
      {availabilityMessage?<div className="network-banner warning" role="status" aria-live="polite">{availabilityMessage}</div>:null}
      <div className="customer-chat-strip"><strong>{status?.chat.state==="live"?"● Customer Chat Live":status?.chat.state==="async"?"Customer Chat Async":"Messaging Not Configured"}</strong><span>{status?.activeResponders.length??0} responder{status?.activeResponders.length===1?"":"s"} available</span></div>
      <main id="main-content" tabIndex={-1}>{children}</main>
    </div>
    <nav className="bottom-nav" aria-label="Mobile primary" style={{gridTemplateColumns:`repeat(${nav.length},1fr)`}}>{nav.map(({href,label})=><a key={href} href={`#${href}`} aria-current={route.startsWith(href)?"page":undefined}>{label}</a>)}</nav>
  </div>;
}

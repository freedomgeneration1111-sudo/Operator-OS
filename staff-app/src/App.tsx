import { useCallback,useEffect,useState } from "react";
import { DevLogin } from "./components/DevLogin";
import { ErrorState,Loading } from "./components/AsyncState";
import { Shell } from "./components/Shell";
import { useHashRoute,useOnline } from "./lib/hooks";
import { usePresence } from "./lib/usePresence";
import { SessionProvider,useSession } from "./lib/session";
import { chatAudio,type ChatAudioState } from "./lib/chatNotifications";
import { usePushActivity } from "./lib/pushNotifications";
import type { OperationsStatus,Responder } from "./lib/types";
import { InboxView } from "./views/InboxView";
import { InquiryDetailView } from "./views/InquiryDetailView";
import { ScheduleView } from "./views/ScheduleView";
import { ChatView } from "./views/ChatView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import { WebsiteView } from "./views/WebsiteView";
import { businessProfile,routeEnabled } from "./lib/business-profile";

export default function App(){return <SessionProvider><SessionGate/></SessionProvider>;}
function SessionGate(){const {session,developmentAuthAllowed,loading,authError,retry}=useSession();if(session)return <OperationsWorkspace/>;if(developmentAuthAllowed)return <DevLogin/>;if(loading)return <Loading label="Verifying secure staff session…"/>;return <main className="login-shell"><section className="login-card"><p className="eyebrow">Secure Staff Access</p><h1>Sign in required</h1><p role="alert">{authError||"Cloudflare Access authentication is required."}</p><a className="button primary" href={`/cdn-cgi/access/login?redirect_url=${encodeURIComponent(window.location.href)}`}>Sign in again</a><button className="button text" onClick={retry}>Retry session check</button></section></main>;}
function OperationsWorkspace(){
  const {session,logout}=useSession();if(!session)throw new Error("Session required");
  const route=useHashRoute();const online=useOnline();const [responders,setResponders]=useState<Responder[]>([]);const [status,setStatus]=useState<OperationsStatus|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [refresh,setRefresh]=useState(0);const [chatAudioState,setChatAudioState]=useState<ChatAudioState>(()=>chatAudio.state());
  const refreshStatus=useCallback(()=>setRefresh((value)=>value+1),[]);
  useEffect(()=>{let active=true;Promise.all([session.client.responders(),session.client.status()]).then(([responderResult,statusResult])=>{if(active){setResponders(responderResult.responders);setStatus(statusResult);setError("");}}).catch((reason)=>{if(active)setError(reason instanceof Error?reason.message:"Could not load staff status.");}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[session.client,refresh]);
  useEffect(()=>{const timer=window.setInterval(refreshStatus,30_000);return()=>window.clearInterval(timer);},[refreshStatus]);
  useEffect(()=>{const unlock=()=>{void chatAudio.unlock().then(setChatAudioState);};document.addEventListener("pointerdown",unlock);document.addEventListener("keydown",unlock);return()=>{document.removeEventListener("pointerdown",unlock);document.removeEventListener("keydown",unlock);};},[]);
  const presence=usePresence(session.client,session.responder.id,status?.presenceTimeoutSeconds??120,refreshStatus);
  usePushActivity(session.client);
  async function endSession(){if(presence.enabled)await presence.toggle(false);logout();}
  if(loading)return <Loading label="Opening staff workspace…"/>;
  if(error&&!status)return <main className="login-shell"><ErrorState message={error} onRetry={refreshStatus}/><button className="button text" onClick={logout}>End Development Session</button></main>;
  const detailMatch=route.match(/^\/inquiry\/([^/?]+)/);
  let content;
  if(detailMatch)content=<InquiryDetailView client={session.client} id={decodeURIComponent(detailMatch[1]!)} responders={responders} currentResponderId={session.responder.id} online={online}/>;
  else if(route.startsWith("/schedule")&&businessProfile.capabilities.schedule)content=<ScheduleView client={session.client}/>;
  else if(route.startsWith("/chat"))content=<ChatView client={session.client} status={status} currentResponderId={session.responder.id} initialConversationId={new URLSearchParams(route.split("?")[1]??"").get("conversation")} audioState={chatAudioState} onAudioStateChange={setChatAudioState}/>;
  else if(route.startsWith("/search"))content=<SearchView client={session.client} responders={responders} currentResponderId={session.responder.id}/>;
  else if(route.startsWith("/settings"))content=<SettingsView client={session.client} status={status} responders={responders} currentResponderId={session.responder.id} availability={presence} onAvailability={(next)=>void presence.toggle(next)}/>;
  else if(route.startsWith("/website")&&(session.user.permissions?.includes("website:manage")||session.user.role==="manager"||session.user.role==="admin"))content=<WebsiteView client={session.client}/>;
  else content=<InboxView client={session.client} responders={responders} currentResponderId={session.responder.id}/>;
  if(!routeEnabled(route,businessProfile)||(route.startsWith("/website")&&!(session.user.permissions?.includes("website:manage")||session.user.role==="manager"||session.user.role==="admin")))content=<InboxView client={session.client} responders={responders} currentResponderId={session.responder.id}/>;
  return <Shell route={route} status={status} availability={presence} availabilityMessage={presence.message} onAvailability={(next)=>void presence.toggle(next)} responderName={`${session.responder.display_label} · ${session.user.role}`} onLogout={()=>void endSession()} canManageWebsite={Boolean(session.user.permissions?.includes("website:manage")||session.user.role==="manager"||session.user.role==="admin")}>{content}</Shell>;
}

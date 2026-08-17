import { useState,type FormEvent } from "react";
import { OperationsClient } from "../lib/api";
import type { Responder } from "../lib/types";
import { useSession } from "../lib/session";
import { businessProfile } from "../lib/business-profile";

export function DevLogin(){
  const { loginDevelopment,developmentAuthAllowed }=useSession();
  const [apiUrl,setApiUrl]=useState(import.meta.env.VITE_OPERATIONS_API_URL??"http://127.0.0.1:8787");
  const [token,setToken]=useState("");const [responders,setResponders]=useState<Responder[]>([]);const [selected,setSelected]=useState("");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  if(!developmentAuthAllowed)return <main className="login-shell"><section className="login-card"><p className="eyebrow">Internal Operations</p><h1>Staff authentication required</h1><p>This production build fails closed because an approved staff identity provider has not been configured.</p></section></main>;
  async function connect(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{const result=await new OperationsClient(apiUrl,{token}).responders();setResponders(result.responders);setSelected(result.responders[0]?.id??"");if(!result.responders.length)setError("No active synthetic responders exist. Run the development seed.");}catch(reason){setError(reason instanceof Error?reason.message:"Could not connect to the operations API.");}finally{setBusy(false);}}
  const responder=responders.find((item)=>item.id===selected);
  return <main className="login-shell"><section className="login-card"><p className="eyebrow">Development Access</p><h1>{businessProfile.appName}</h1><p className="muted">This is a provisional local responder session—not production authentication.</p>
    {!responders.length?<form onSubmit={connect} className="form-stack"><label>Operations API URL<input name="apiUrl" type="url" autoComplete="url" value={apiUrl} onChange={(event)=>setApiUrl(event.target.value)} required/></label><label>Development API token<input name="token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(event)=>setToken(event.target.value)} required/></label><button className="button primary" disabled={busy}>{busy?"Connecting…":"Connect to Local Operations"}</button></form>:
    <div className="form-stack"><label>Act as responder<select name="responder" value={selected} onChange={(event)=>setSelected(event.target.value)}>{responders.map((item)=><option key={item.id} value={item.id}>{item.display_label}</option>)}</select></label><button className="button primary" disabled={!responder} onClick={()=>{if(responder)loginDevelopment(apiUrl,token,responder);}}>Open Staff Workspace</button><button className="button text" onClick={()=>setResponders([])}>Use Different Connection</button></div>}
    {error?<p className="inline-error" role="alert">{error}</p>:null}
  </section></main>;
}

import { useEffect,useState } from "react";
import type { OperationsClient } from "../lib/api";
import type { Conversation,OperationsStatus } from "../lib/types";
import { Empty,ErrorState,Loading } from "../components/AsyncState";
import { formatDate,formatDateTime,humanize } from "../lib/format";

export function ChatView({ client,status }:{ client:OperationsClient;status:OperationsStatus|null }){
  const [items,setItems]=useState<Conversation[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
  useEffect(()=>{let active=true;client.conversations().then((result)=>{if(active)setItems(result.conversations);}).catch((reason)=>{if(active)setError(reason instanceof Error?reason.message:"Could not load conversations.");}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[client]);
  return <section className="view"><div className="view-heading"><div><p className="eyebrow">Provider-Neutral Workspace</p><h1>Chat</h1><p>Conversation metadata only. No messages are synchronized in this phase.</p></div></div>
    <div className="status-grid"><article className="metric-card"><span>Customer-facing state</span><strong>{status?.chat.label??"Checking…"}</strong><small>{status?.activeResponders.length??0} live responder(s)</small></article><article className="metric-card"><span>Messaging provider</span><strong>{status?.messaging.configured?status.messaging.provider:"Setup needed"}</strong><small>{status?.messaging.configured?"Verified destination configured":"No working destination is exposed"}</small></article></div>
    {!status?.messaging.configured?<div className="setup-callout"><strong>Messaging provider not configured</strong><p>Select and verify a shared business messaging provider before staff can open customer conversations here.</p></div>:null}
    <h2 className="section-title">Conversation Records</h2>{loading?<Loading label="Loading conversation metadata…"/>:error?<ErrorState message={error}/>:!items.length?<Empty title="No conversations recorded" detail="Inquiry records remain available in the inbox. No message contents are fabricated."/>:<div className="conversation-list">{items.map((item)=><a className="conversation-card" href={item.inquiry_id?`#/inquiry/${encodeURIComponent(item.inquiry_id)}`:"#/chat"} key={item.id}><div><h3>{item.full_name}</h3><p>{item.event_family??"Event pending"} · {formatDate(item.start_date)}</p></div><div><span className="badge neutral">{item.provider}</span><span>{humanize(item.channel_state)}</span><time dateTime={item.updated_at}>{formatDateTime(item.updated_at)}</time></div></a>)}</div>}
  </section>;
}

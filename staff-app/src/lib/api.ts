import type { Assessment,Conversation,InboxResponse,InquiryDetail,OperationsStatus,Responder,ScheduleEvent,WorkflowState } from "./types";

export class ApiError extends Error { constructor(message:string,readonly status:number,readonly code?:string){ super(message); } }

export class OperationsClient {
  constructor(readonly baseUrl:string,private readonly token:string) {}
  private async request<T>(path:string,init:RequestInit={}) {
    const response=await fetch(`${this.baseUrl.replace(/\/$/,"")}${path}`,{
      ...init,headers:{ "Content-Type":"application/json",Authorization:`Bearer ${this.token}`,...init.headers },
    });
    const body: unknown=await response.json().catch(()=>null);
    if(!response.ok){
      const error=readError(body);
      throw new ApiError(error.message,response.status,error.code);
    }
    return body as T;
  }
  responders(){ return this.request<{ ok:true;responders:Responder[] }>("/v1/internal/responders"); }
  status(){ return this.request<OperationsStatus>("/v1/internal/status"); }
  inbox(params:URLSearchParams){ return this.request<InboxResponse>(`/v1/internal/inbox?${params}`); }
  detail(id:string){ return this.request<InquiryDetail>(`/v1/internal/inquiries/${encodeURIComponent(id)}`); }
  conflicts(id:string){ return this.request<{ ok:true;assessment:Assessment }>(`/v1/internal/inquiries/${encodeURIComponent(id)}/conflicts`); }
  schedule(start:string,end:string,state="all"){ return this.request<{ ok:true;range:{start:string;end:string};capacity:number;events:ScheduleEvent[] }>(`/v1/internal/schedule?start=${start}&end=${end}&state=${encodeURIComponent(state)}`); }
  conversations(query=""){ return this.request<{ ok:true;conversations:Conversation[] }>(`/v1/internal/conversations${query?`?query=${encodeURIComponent(query)}`:""}`); }
  workflow(id:string,state:WorkflowState,actorId:string){ return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/workflow`,{ method:"PATCH",body:JSON.stringify({ state,actorId }) }); }
  note(id:string,body:string,actorId:string){ return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/notes`,{ method:"POST",body:JSON.stringify({ body,actorId }) }); }
  assignment(id:string,responderId:string,assigned:boolean,actorId:string){ return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/assignment`,{ method:"PATCH",body:JSON.stringify({ responderId,assigned,actorId }) }); }
  capacity(id:string,blocksCapacity:boolean,actorId:string){ return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/capacity`,{ method:"PATCH",body:JSON.stringify({ blocksCapacity,actorId }) }); }
  heartbeat(responderId:string,available:boolean){ return this.request<{ ok:true;state:"available"|"unavailable";expiresAt:string }>("/v1/internal/presence/heartbeat",{ method:"POST",body:JSON.stringify({ responderId,available }) }); }
}

function readError(value:unknown){
  if(typeof value==="object"&&value&&"error" in value&&typeof value.error==="object"&&value.error&&"message" in value.error&&typeof value.error.message==="string"){
    return { message:value.error.message,code:"code" in value.error&&typeof value.error.code==="string"?value.error.code:undefined };
  }
  return { message:"The operations service could not complete this request.",code:undefined };
}

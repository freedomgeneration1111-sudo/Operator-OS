import type { Assessment,Conversation,InboxResponse,InquiryDetail,OperationsStatus,Responder,ScheduleEvent,StaffUser,WorkflowState } from "./types";
export class ApiError extends Error{constructor(message:string,readonly status:number,readonly code?:string){super(message);}}
type DevelopmentAuth={token:string;responderId?:string};
export class OperationsClient{
  constructor(readonly baseUrl:string,private readonly developmentAuth?:DevelopmentAuth,private readonly onUnauthenticated?:()=>void){}
  private async request<T>(path:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set("Content-Type","application/json");if(this.developmentAuth){headers.set("Authorization",`Bearer ${this.developmentAuth.token}`);if(this.developmentAuth.responderId)headers.set("X-Development-Responder-Id",this.developmentAuth.responderId);}const response=await fetch(`${this.baseUrl.replace(/\/$/,"")}${path}`,{...init,headers,credentials:"include",redirect:"follow"});const body:unknown=await response.json().catch(()=>null);if(!response.ok){const error=readError(body);if(response.status===401)this.onUnauthenticated?.();throw new ApiError(error.message,response.status,error.code);}return body as T;}
  me(){return this.request<{ok:true;user:StaffUser}>("/v1/internal/me");}
  responders(){return this.request<{ok:true;responders:Responder[]}>("/v1/internal/responders");}
  status(){return this.request<OperationsStatus>("/v1/internal/status");}
  inbox(params:URLSearchParams){return this.request<InboxResponse>(`/v1/internal/inbox?${params}`);}
  detail(id:string){return this.request<InquiryDetail>(`/v1/internal/inquiries/${encodeURIComponent(id)}`);}
  conflicts(id:string){return this.request<{ok:true;assessment:Assessment}>(`/v1/internal/inquiries/${encodeURIComponent(id)}/conflicts`);}
  schedule(start:string,end:string,state="all"){return this.request<{ok:true;range:{start:string;end:string};capacity:number;events:ScheduleEvent[]}>(`/v1/internal/schedule?start=${start}&end=${end}&state=${encodeURIComponent(state)}`);}
  conversations(query=""){return this.request<{ok:true;conversations:Conversation[]}>(`/v1/internal/conversations${query?`?query=${encodeURIComponent(query)}`:""}`);}
  workflow(id:string,state:WorkflowState){return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/workflow`,{method:"PATCH",body:JSON.stringify({state})});}
  note(id:string,body:string){return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/notes`,{method:"POST",body:JSON.stringify({body})});}
  assignment(id:string,responderId:string,assigned:boolean){return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/assignment`,{method:"PATCH",body:JSON.stringify({responderId,assigned})});}
  capacity(id:string,blocksCapacity:boolean){return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/capacity`,{method:"PATCH",body:JSON.stringify({blocksCapacity})});}
  heartbeat(available:boolean){return this.request<{ok:true;state:"available"|"unavailable";expiresAt:string}>("/v1/internal/presence/heartbeat",{method:"POST",body:JSON.stringify({available})});}
}
function readError(value:unknown){if(typeof value==="object"&&value&&"error" in value&&typeof value.error==="object"&&value.error&&"message" in value.error&&typeof value.error.message==="string")return{message:value.error.message,code:"code" in value.error&&typeof value.error.code==="string"?value.error.code:undefined};return{message:"The operations service could not complete this request.",code:undefined};}

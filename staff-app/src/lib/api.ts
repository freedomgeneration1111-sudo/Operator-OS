import type { CmsContent,CmsDocumentKey,CmsHistory,CmsState } from "./cms-types";
import type { Assessment,Conversation,ConversationDetail,InboxResponse,InquiryDetail,OperationsStatus,Responder,ScheduleEvent,StaffUser,WorkflowState } from "./types";
export class ApiError extends Error{constructor(message:string,readonly status:number,readonly code?:string){super(message);}}
type DevelopmentAuth={token:string;responderId?:string};
export class OperationsClient{
  constructor(readonly baseUrl:string,private readonly developmentAuth?:DevelopmentAuth,private readonly onUnauthenticated?:()=>void){}
  private async request<T>(path:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set("Content-Type","application/json");if(this.developmentAuth){headers.set("Authorization",`Bearer ${this.developmentAuth.token}`);if(this.developmentAuth.responderId)headers.set("X-Development-Responder-Id",this.developmentAuth.responderId);}const response=await fetch(`${this.baseUrl.replace(/\/$/,"")}${path}`,{...init,headers,credentials:"include",redirect:"follow"});const contentType=response.headers.get("Content-Type")??"";if(response.redirected||!contentType.toLowerCase().includes("application/json")){this.onUnauthenticated?.();throw new ApiError("Your staff session requires authentication.",401,"authentication_required");}const body:unknown=await response.json().catch(()=>null);if(!response.ok){const error=readError(body);if(response.status===401)this.onUnauthenticated?.();throw new ApiError(error.message,response.status,error.code);}return body as T;}
  me(){return this.request<{ok:true;user:StaffUser}>("/v1/internal/me");}
  responders(){return this.request<{ok:true;responders:Responder[]}>("/v1/internal/responders");}
  status(){return this.request<OperationsStatus>("/v1/internal/status");}
  inbox(params:URLSearchParams){return this.request<InboxResponse>(`/v1/internal/inbox?${params}`);}
  detail(id:string){return this.request<InquiryDetail>(`/v1/internal/inquiries/${encodeURIComponent(id)}`);}
  conflicts(id:string){return this.request<{ok:true;assessment:Assessment}>(`/v1/internal/inquiries/${encodeURIComponent(id)}/conflicts`);}
  schedule(start:string,end:string,state="all"){return this.request<{ok:true;range:{start:string;end:string};capacity:number;events:ScheduleEvent[]}>(`/v1/internal/schedule?start=${start}&end=${end}&state=${encodeURIComponent(state)}`);}
  conversations(query=""){return this.request<{ok:true;conversations:Conversation[]}>(`/v1/internal/conversations${query?`?query=${encodeURIComponent(query)}`:""}`);}
  conversation(id:string){return this.request<ConversationDetail>(`/v1/internal/conversations/${encodeURIComponent(id)}`);}
  reply(id:string,body:string,clientMessageId=crypto.randomUUID()){return this.request<{ok:true;message:unknown;continuity?:{status:"customer_active"|"email_pending"|"whatsapp_dispatched"|"not_applicable"}}>(`/v1/internal/conversations/${encodeURIComponent(id)}/messages`,{method:"POST",body:JSON.stringify({body,clientMessageId})});}
  conversationAssignment(id:string,responderId:string|null){return this.request(`/v1/internal/conversations/${encodeURIComponent(id)}/assignment`,{method:"PATCH",body:JSON.stringify({responderId})});}
  markConversationRead(id:string){return this.request(`/v1/internal/conversations/${encodeURIComponent(id)}/read`,{method:"POST"});}
  chatEventsSocket(){const base=this.baseUrl||window.location.origin;const url=new URL(`/v1/internal/chat/socket`,base);url.protocol=url.protocol==="https:"?"wss:":"ws:";return new WebSocket(url);}
  workflow(id:string,state:WorkflowState){return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/workflow`,{method:"PATCH",body:JSON.stringify({state})});}
  note(id:string,body:string){return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/notes`,{method:"POST",body:JSON.stringify({body})});}
  assignment(id:string,responderId:string,assigned:boolean){return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/assignment`,{method:"PATCH",body:JSON.stringify({responderId,assigned})});}
  capacity(id:string,blocksCapacity:boolean){return this.request(`/v1/internal/inquiries/${encodeURIComponent(id)}/capacity`,{method:"PATCH",body:JSON.stringify({blocksCapacity})});}
  cmsState(){return this.request<CmsState>("/v1/internal/cms");}
  cmsHistory(key:CmsDocumentKey){return this.request<CmsHistory>(`/v1/internal/cms/documents/${key}/revisions`);}
  saveCmsDocument(key:CmsDocumentKey,expectedRevisionId:string,content:CmsContent){return this.request<{ok:true;document:unknown}>(`/v1/internal/cms/documents/${key}`,{method:"PUT",body:JSON.stringify({expectedRevisionId,content})});}
  restoreCmsRevision(key:CmsDocumentKey,expectedRevisionId:string,revisionId:string){return this.request<{ok:true;document:unknown}>(`/v1/internal/cms/documents/${key}/restore`,{method:"POST",body:JSON.stringify({expectedRevisionId,revisionId})});}
  cmsSnapshot(){return this.request<Record<string,unknown>>("/v1/internal/cms/snapshot");}
  heartbeat(available:boolean){return this.request<{ok:true;state:"available"|"unavailable";expiresAt:string}>("/v1/internal/presence/heartbeat",{method:"POST",body:JSON.stringify({available})});}
  pushConfig(){return this.request<{ok:true;configured:boolean;publicKey:string|null;subscriptionCount:number}>("/v1/internal/push/config");}
  registerPush(subscription:PushSubscriptionJSON){return this.request<{ok:true;subscriptionId:string}>("/v1/internal/push/subscriptions",{method:"PUT",body:JSON.stringify(subscription)});}
  removePush(endpoint:string){return this.request<{ok:true}>("/v1/internal/push/subscriptions",{method:"DELETE",body:JSON.stringify({endpoint})});}
  pushActivity(endpoint:string,foreground:boolean){return this.request<{ok:true;activeUntil:string}>("/v1/internal/push/activity",{method:"POST",body:JSON.stringify({endpoint,foreground}),keepalive:!foreground});}
  pushStatus(endpoint:string){return this.request<{ok:true;registered:boolean;enabled:boolean;activeUntil:string|null;lastSuccessAt:string|null;lastFailureAt:string|null;lastFailureCode:string|null}>("/v1/internal/push/status",{method:"POST",body:JSON.stringify({endpoint})});}
  testPush(endpoint:string){return this.request<{ok:true;status:"delivered";acceptedStatus:number;deliveredAt:string}>("/v1/internal/push/test",{method:"POST",body:JSON.stringify({endpoint})});}
}
function readError(value:unknown){if(typeof value==="object"&&value&&"error" in value&&typeof value.error==="object"&&value.error&&"message" in value.error&&typeof value.error.message==="string")return{message:value.error.message,code:"code" in value.error&&typeof value.error.code==="string"?value.error.code:undefined};return{message:"The operations service could not complete this request.",code:undefined};}

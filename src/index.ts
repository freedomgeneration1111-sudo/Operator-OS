import { z } from "zod";
import { AuthenticationError,authenticateStaff,requirePermission,type StaffIdentity } from "./auth";
import { AvailabilityApiError,handleAvailability } from "./availability-api";
import { refreshAvailabilityCache } from "./availability-cache";
import { consultingInquirySchema,inquiryRequestSchema,type ApiErrorResponse } from "./contracts";
import { handleCrm } from "./crm";
import { createConsultingInquiry,createFocusInquiry } from "./inquiry-adapters";
import { enforceInquiryProtection,InquiryProtectionError } from "./inquiry-protection";
import { dispatchConsultingInquiryNotificationEmail } from "./ops-notify";
import { handleStaffApi } from "./staff-api";
import { NativeChatError,internalConversationRoute,nativeChatStatus,publicConversationRoute,publicResumeConversation,startNativeConversation } from "./native-chat";
import { handlePushApi } from "./push";
import { handleWhatsAppVerify,handleWhatsAppWebhook,WhatsAppWebhookError } from "./whatsapp";
import { resolveClientBusinessProfile } from "../business-profiles.mts";
export { ChatRoom,StaffChatHub } from "./chat-durable";

const heartbeatSchema=z.object({available:z.boolean()}).strict();
const IDEMPOTENCY_PATTERN=/^[A-Za-z0-9._:-]{8,128}$/;const MAX_BODY_BYTES=16_384;
function corsHeaders(request:Request,env:Env):Record<string,string>{const origin=request.headers.get("Origin");const allowed=env.PUBLIC_SITE_ORIGIN?.split(",").map((entry)=>entry.trim()).filter(Boolean)??[];return origin&&allowed.includes(origin)?{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"Content-Type, Idempotency-Key, Authorization, X-Development-Responder-Id, X-Chat-Resume-Token","Access-Control-Allow-Methods":"GET, POST, PATCH, OPTIONS","Access-Control-Max-Age":"86400",Vary:"Origin"}:{};}
function json(data:object,status=200,headers:HeadersInit={}){return Response.json(data,{status,headers:{"Cache-Control":"no-store",...headers}});}
async function parseBoundedJson(request:Request):Promise<unknown>{const length=Number(request.headers.get("Content-Length")??0);if(length>MAX_BODY_BYTES)throw new PublicError(413,"payload_too_large","Request body is too large");const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)throw new PublicError(413,"payload_too_large","Request body is too large");try{return JSON.parse(text) as unknown;}catch{throw new PublicError(400,"invalid_json","Request body must be valid JSON");}}
class PublicError extends Error{constructor(readonly status:number,readonly code:string,message:string,readonly fields?:Record<string,string[]>){super(message);}}
async function publicInquiry(request:Request,env:Env,ctx:ExecutionContext,kind:"event"|"consulting"){
  const key=request.headers.get("Idempotency-Key");
  if(!key||!IDEMPOTENCY_PATTERN.test(key))throw new PublicError(400,"invalid_idempotency_key","A valid Idempotency-Key header is required");
  const body=await parseBoundedJson(request);
  const envelope=z.object({turnstileToken:z.string().trim().min(1).max(2048),website:z.string().trim().max(300).optional().default("")}).passthrough().safeParse(body);
  if(!envelope.success)throw new PublicError(422,"validation_error","Request validation failed",envelope.error.flatten().fieldErrors as Record<string,string[]>);
  const {turnstileToken,website,...inquiryInput}=envelope.data;
  await enforceInquiryProtection(request,env,{turnstileToken,website});
  const now=new Date().toISOString();
  if(kind==="event"){
    const parsed=inquiryRequestSchema.safeParse(inquiryInput);
    if(!parsed.success)throw new PublicError(422,"validation_error","Request validation failed",parsed.error.flatten().fieldErrors as Record<string,string[]>);
    const result=await createFocusInquiry(env.DB,parsed.data,key,now);
    return json(result,result.idempotentReplay?200:201);
  }
  const parsed=consultingInquirySchema.safeParse(inquiryInput);
  if(!parsed.success)throw new PublicError(422,"validation_error","Request validation failed",parsed.error.flatten().fieldErrors as Record<string,string[]>);
  const result=await createConsultingInquiry(env.DB,parsed.data,key,now);
  if(!result.idempotentReplay){
    ctx.waitUntil(dispatchConsultingInquiryNotificationEmail(env,{inquiryId:result.inquiryId}).catch((error:unknown)=>{
      console.error(JSON.stringify({message:"consulting inquiry notification failed",inquiryId:result.inquiryId,error:error instanceof Error?error.message:"Unknown error"}));
    }));
  }
  return json(result,result.idempotentReplay?200:201);
}
async function heartbeat(request:Request,env:Env,actor:StaffIdentity){requirePermission(actor,"presence:self");const parsed=heartbeatSchema.safeParse(await parseBoundedJson(request));if(!parsed.success)throw new PublicError(422,"validation_error","Request validation failed",parsed.error.flatten().fieldErrors as Record<string,string[]>);const nowDate=new Date();const timeoutSeconds=positiveInteger(env.PRESENCE_TIMEOUT_SECONDS,120);const expiresAt=new Date(nowDate.getTime()+timeoutSeconds*1000).toISOString();await env.DB.prepare(`INSERT INTO responder_presence (responder_id,available,heartbeat_at,expires_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(responder_id) DO UPDATE SET available=excluded.available,heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(actor.id,parsed.data.available?1:0,nowDate.toISOString(),expiresAt,nowDate.toISOString()).run();return json({ok:true,state:parsed.data.available?"available":"unavailable",expiresAt});}
async function route(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url);
  const profile=resolveClientBusinessProfile(env.BUSINESS_PROFILE);
  const publicApiEnabled=env.PUBLIC_API_ENABLED!=="false";
  if(request.method==="GET"&&url.pathname==="/health")return json({ok:true,service:`operator-os-${profile.key}`,business:profile.key,deployment:env.DEPLOYMENT_KEY??null});
  if(request.method==="POST"&&url.pathname==="/v1/inquiries"&&publicApiEnabled&&profile.publicEventInquiry)return publicInquiry(request,env,ctx,"event");
  if(request.method==="POST"&&url.pathname==="/v1/inquiries"&&publicApiEnabled&&profile.publicConsultingInquiry)return publicInquiry(request,env,ctx,"consulting");
  if(url.pathname==="/v1/availability"&&(!publicApiEnabled||!profile.capabilities.availability))return json({ok:false,error:{code:"module_disabled",message:"Availability checks are not enabled for this deployment"}},404);
  if(request.method==="GET"&&url.pathname==="/v1/availability")return handleAvailability(request,env);
  if(url.pathname.startsWith("/v1/chat/")&&(!publicApiEnabled||!profile.publicChat))return json({ok:false,error:{code:"module_disabled",message:"Public chat is not enabled for this deployment"}},404);
  if(request.method==="POST"&&url.pathname==="/v1/chat/conversations")return startNativeConversation(request,env);
  if(url.pathname==="/v1/chat/resume"){const resumed=await publicResumeConversation(request,env);if(resumed)return resumed;}
  if(url.pathname.startsWith("/v1/chat/conversations/")){const chat=await publicConversationRoute(request,env,url.pathname);if(chat)return chat;}
  if(request.method==="GET"&&url.pathname==="/v1/chat/status")return Response.json(await nativeChatStatus(env.DB,new Date().toISOString()),{headers:{"Cache-Control":"public, max-age=15, stale-while-revalidate=30"}});
  if(url.pathname==="/v1/webhooks/whatsapp"&&!profile.capabilities.whatsappChannel)return json({ok:false,error:{code:"module_disabled",message:"WhatsApp channel is not enabled for this deployment"}},404);
  if(request.method==="GET"&&url.pathname==="/v1/webhooks/whatsapp")return handleWhatsAppVerify(request,env);
  if(request.method==="POST"&&url.pathname==="/v1/webhooks/whatsapp")return handleWhatsAppWebhook(request,env,ctx);
  if(url.pathname.startsWith("/v1/internal/chat/")||url.pathname.startsWith("/v1/internal/conversations/")||url.pathname==="/v1/internal/push/test"){if(env.CHAT_API)return env.CHAT_API.fetch(request);}
  if(url.pathname.startsWith("/v1/internal/")){
    const actor=await authenticateStaff(request,env);const push=await handlePushApi(request,env,url.pathname,actor);if(push)return push;
    if(!profile.capabilities.schedule&&url.pathname==="/v1/internal/schedule")return json({ok:false,error:{code:"module_disabled",message:"Scheduling is not enabled for this deployment"}},404);
    if(!profile.capabilities.capacity&&/^\/v1\/internal\/inquiries\/[^/]+\/(capacity|conflicts)$/.test(url.pathname))return json({ok:false,error:{code:"module_disabled",message:"Event capacity is not enabled for this deployment"}},404);
    const nativeChat=await internalConversationRoute(request,env,url.pathname,actor);if(nativeChat)return nativeChat;
    if(request.method==="POST"&&url.pathname==="/v1/internal/presence/heartbeat")return heartbeat(request,env,actor);
    const capacity=positiveInteger(env.CONCURRENT_EVENT_CAPACITY,1);const staff=await handleStaffApi(request,env,url.pathname,capacity,actor);if(staff)return staff;
    return handleCrm(request,env.DB,url.pathname,capacity,actor);
  }
  if(env.ASSETS&&isStaffAssetHost(url,env))return env.ASSETS.fetch(request);
  return json({ok:false,error:{code:"not_found",message:"Route not found"}},404);
}
function isStaffAssetHost(url:URL,env:Env){const configured=env.STAFF_HOSTNAME?.split(",").map((value)=>value.trim().toLowerCase()).filter(Boolean)??[];return configured.includes(url.hostname.toLowerCase());}
function positiveInteger(value:string|undefined,fallback:number){const parsed=Number(value);return Number.isInteger(parsed)&&parsed>0?parsed:fallback;}
export default{
  async scheduled(_event,env,ctx){ctx.waitUntil(refreshAvailabilityCache(env).catch((error:unknown)=>{console.error(JSON.stringify({message:"availability cache refresh failed",error:error instanceof Error?error.message:"Unknown error"}));}));},
  async fetch(request,env,ctx):Promise<Response>{const cors=corsHeaders(request,env);if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});try{const response=await route(request,env,ctx);if(response.webSocket)return response;const headers=new Headers(response.headers);for(const [key,value] of Object.entries(cors))headers.set(key,value);return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}catch(error){if(error instanceof NativeChatError)return json({ok:false,error:{code:error.code,message:error.message}},error.status,cors);if(error instanceof InquiryProtectionError)return json({ok:false,error:{code:error.code,message:error.message}},error.status,cors);if(error instanceof AvailabilityApiError)return json({ok:false,error:{code:error.code,message:error.message}},error.status,cors);if(error instanceof WhatsAppWebhookError)return new Response(error.message,{status:error.status,headers:cors});if(error instanceof PublicError){const body:ApiErrorResponse={ok:false,error:{code:error.code,message:error.message,...(error.fields?{fields:error.fields}:{})}};return json(body,error.status,cors);}if(error instanceof AuthenticationError)return json({ok:false,error:{code:error.code,message:error.message}},error.status,{...cors,...(error.status===401?{"WWW-Authenticate":"CF-Access"}:{})});console.error(JSON.stringify({message:"operations request failed",path:new URL(request.url).pathname,error:error instanceof Error?error.message:"Unknown error"}));return json({ok:false,error:{code:"internal_error",message:"The operation could not be completed"}},500,cors);}}} satisfies ExportedHandler<Env>;

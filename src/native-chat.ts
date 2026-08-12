import { z } from "zod";
import { requirePermission,type StaffIdentity } from "./auth";
import { hashResumeToken,markCustomerConversationResumed,randomResumeToken,resolveConversationResumeToken } from "./resume-tokens";

const startSchema=z.object({
  name:z.string().trim().min(1).max(120),
  email:z.string().trim().email().max(254),
  phone:z.string().trim().max(40).optional(),
  message:z.string().trim().min(1).max(2000),
  clientMessageId:z.string().trim().min(8).max(128),
  website:z.string().trim().max(300).optional().default(""),
}).strict();
const messageSchema=z.object({body:z.string().trim().min(1).max(2000),clientMessageId:z.string().trim().min(8).max(128)}).strict();
const assignmentSchema=z.object({responderId:z.string().trim().min(1).max(100).nullable()}).strict();

export class NativeChatError extends Error{constructor(readonly status:number,readonly code:string,message:string){super(message);}}

export async function nativeChatStatus(db:D1Database,now:string){
  const row=await db.prepare(`SELECT COUNT(*) AS count FROM responder_presence p JOIN responders r ON r.id=p.responder_id
    WHERE r.active=1 AND p.available=1 AND p.expires_at>?`).bind(now).first<{count:number}>();
  const live=Number(row?.count??0)>0;
  return {state:live?"live":"async",label:live?"Live Chat":"Send us a Message",destinationUrl:null,checkedAt:now};
}

export async function startNativeConversation(request:Request,env:Env){
  const parsed=startSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)throw new NativeChatError(422,"validation_error","Please check the highlighted chat details");
  if(parsed.data.website)throw new NativeChatError(400,"invalid_submission","The message could not be sent");
  await enforceChatRateLimit(request,env,"start");
  const now=new Date().toISOString();const proposedContactId=crypto.randomUUID();const conversationId=crypto.randomUUID();const resumeToken=randomResumeToken();const tokenHash=await hashResumeToken(resumeToken);const email=parsed.data.email.toLowerCase();
  await env.DB.prepare(`INSERT OR IGNORE INTO contacts (id,full_name,email,phone,preferred_contact,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).bind(proposedContactId,parsed.data.name,email,parsed.data.phone||null,"email",now,now).run();
  const contact=await env.DB.prepare("SELECT id FROM contacts WHERE lower(email)=?").bind(email).first<{id:string}>();if(!contact)throw new NativeChatError(500,"conversation_not_saved","The conversation could not be created");
  await env.DB.prepare(`INSERT INTO conversations (id,contact_id,provider,channel_state,public_resume_token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).bind(conversationId,contact.id,"native_web","open",tokenHash,now,now).run();
  const result=await persistThroughRoom(env,conversationId,{senderKind:"customer",senderResponderId:null,body:parsed.data.message,clientMessageId:parsed.data.clientMessageId});
  return Response.json({ok:true,conversation:{id:conversationId,resumeToken,mode:(await nativeChatStatus(env.DB,now)).state},...result},{status:201,headers:{"Cache-Control":"no-store"}});
}

export async function publicConversationRoute(request:Request,env:Env,path:string){
  const match=path.match(/^\/v1\/chat\/conversations\/([^/]+)(?:\/(messages|socket))?$/);if(!match)return null;
  const conversationId=match[1]!;const action=match[2];const resumeToken=new URL(request.url).searchParams.get("resume")??request.headers.get("X-Chat-Resume-Token");
  const authorization=await authorizeCustomer(env.DB,conversationId,resumeToken);
  if(request.method==="GET"&&action==="messages"){await markCustomerConversationResumed(env.DB,conversationId,authorization.tokenId);return history(env.DB,conversationId);}
  if(request.method==="POST"&&action==="messages"){
    await enforceChatRateLimit(request,env,"message");const parsed=messageSchema.safeParse(await request.json().catch(()=>null));
    if(!parsed.success)throw new NativeChatError(422,"validation_error","Message is required");
    await markCustomerConversationResumed(env.DB,conversationId,authorization.tokenId);
    const result=await persistThroughRoom(env,conversationId,{senderKind:"customer",senderResponderId:null,...parsed.data});return Response.json({ok:true,...result},{status:201});
  }
  if(request.method==="GET"&&action==="socket"&&request.headers.get("Upgrade")==="websocket"){await markCustomerConversationResumed(env.DB,conversationId,authorization.tokenId);return room(env,conversationId).fetch(new Request(`https://chat-room/connect?kind=customer&conversationId=${encodeURIComponent(conversationId)}`,request));}
  return null;
}

export async function publicResumeConversation(request:Request,env:Env){
  if(request.method!=="GET")return null;
  await enforceChatRateLimit(request,env,"resume");
  const token=request.headers.get("X-Chat-Resume-Token")??new URL(request.url).searchParams.get("resume");
  const authorization=await resolveConversationResumeToken(env.DB,token);
  if(!authorization)throw new NativeChatError(403,"conversation_access_denied","This conversation link is invalid or no longer available");
  await markCustomerConversationResumed(env.DB,authorization.conversationId,authorization.tokenId);
  const result=await env.DB.prepare("SELECT id,client_message_id,sequence,sender_kind,body,created_at FROM conversation_messages WHERE conversation_id=? ORDER BY sequence LIMIT 500").bind(authorization.conversationId).all();
  return Response.json({ok:true,conversation:{id:authorization.conversationId},messages:result.results},{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
}

export async function internalConversationRoute(request:Request,env:Env,path:string,actor:StaffIdentity){
  requirePermission(actor,"crm:read");
  if(path==="/v1/internal/chat/socket"&&request.method==="GET"&&request.headers.get("Upgrade")==="websocket"){
    if(!env.CHAT_STAFF_HUB)throw new NativeChatError(503,"chat_unavailable","Chat is temporarily unavailable");return env.CHAT_STAFF_HUB.getByName("staff-events").fetch(new Request(`https://staff-hub/connect?responderId=${encodeURIComponent(actor.id)}`,request));
  }
  const match=path.match(/^\/v1\/internal\/conversations\/([^/]+)(?:\/(messages|socket|assignment|read))?$/);if(!match)return null;
  const conversationId=match[1]!;const action=match[2];await requireConversation(env.DB,conversationId);
  if(request.method==="GET"&&!action)return conversationDetail(env.DB,conversationId,actor.id);
  if(request.method==="GET"&&action==="messages")return history(env.DB,conversationId);
  if(request.method==="GET"&&action==="socket"&&request.headers.get("Upgrade")==="websocket")return room(env,conversationId).fetch(new Request(`https://chat-room/connect?kind=responder&responderId=${encodeURIComponent(actor.id)}&conversationId=${encodeURIComponent(conversationId)}`,request));
  if(request.method==="POST"&&action==="messages"){
    const parsed=messageSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new NativeChatError(422,"validation_error","Message is required");
    const result=await persistThroughRoom(env,conversationId,{senderKind:"responder",senderResponderId:actor.id,...parsed.data});return Response.json({ok:true,...result},{status:201});
  }
  if(request.method==="PATCH"&&action==="assignment"){
    const parsed=assignmentSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new NativeChatError(422,"validation_error","Invalid assignment");
    if(parsed.data.responderId!==null&&parsed.data.responderId!==actor.id)requirePermission(actor,"assignment:manage");
    const now=new Date().toISOString();await env.DB.batch([
      env.DB.prepare("UPDATE conversations SET assigned_responder_id=?,updated_at=? WHERE id=?").bind(parsed.data.responderId,now,conversationId),
      env.DB.prepare("INSERT INTO conversation_activity VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),conversationId,"responder",actor.id,parsed.data.responderId?"conversation_assigned":"conversation_unassigned",JSON.stringify({responderId:parsed.data.responderId}),now),
    ]);return Response.json({ok:true,assignedResponderId:parsed.data.responderId});
  }
  if(request.method==="POST"&&action==="read"){
    const latest=await env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS sequence FROM conversation_messages WHERE conversation_id=?").bind(conversationId).first<{sequence:number}>();const now=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO conversation_reads VALUES (?,?,?,?) ON CONFLICT(conversation_id,responder_id) DO UPDATE SET last_read_sequence=excluded.last_read_sequence,updated_at=excluded.updated_at`).bind(conversationId,actor.id,Number(latest?.sequence??0),now).run();return Response.json({ok:true});
  }
  return null;
}

async function conversationDetail(db:D1Database,id:string,responderId:string){
  const [conversation,messages,activity,notification]=await db.batch([
    db.prepare(`SELECT cv.id,cv.provider,cv.channel_state,cv.assigned_responder_id,cv.created_at,cv.updated_at,cv.last_message_at,c.full_name,c.email,c.phone,r.display_label AS assigned_responder_label FROM conversations cv JOIN contacts c ON c.id=cv.contact_id LEFT JOIN responders r ON r.id=cv.assigned_responder_id WHERE cv.id=?`).bind(id),
    db.prepare(`SELECT m.id,m.client_message_id,m.sequence,m.sender_kind,m.sender_responder_id,m.body,m.created_at,r.display_label AS sender_label FROM conversation_messages m LEFT JOIN responders r ON r.id=m.sender_responder_id WHERE m.conversation_id=? ORDER BY m.sequence LIMIT 500`).bind(id),
    db.prepare("SELECT actor_kind,actor_id,activity_type,metadata_json,created_at FROM conversation_activity WHERE conversation_id=? ORDER BY created_at DESC LIMIT 100").bind(id),
    db.prepare("SELECT status,provider,attempted_at,completed_at,failure_code,cleared_at FROM conversation_notifications WHERE conversation_id=? ORDER BY attempted_at DESC LIMIT 1").bind(id),
  ]);await markRead(db,id,responderId);return Response.json({ok:true,conversation:conversation!.results[0],messages:messages!.results,activity:activity!.results,customerNotification:notification!.results[0]??null});
}
async function history(db:D1Database,id:string){const result=await db.prepare("SELECT id,client_message_id,sequence,sender_kind,body,created_at FROM conversation_messages WHERE conversation_id=? ORDER BY sequence LIMIT 500").bind(id).all();return Response.json({ok:true,messages:result.results},{headers:{"Cache-Control":"no-store"}});}
async function markRead(db:D1Database,id:string,responderId:string){const latest=await db.prepare("SELECT COALESCE(MAX(sequence),0) AS sequence FROM conversation_messages WHERE conversation_id=?").bind(id).first<{sequence:number}>();await db.prepare(`INSERT INTO conversation_reads VALUES (?,?,?,?) ON CONFLICT(conversation_id,responder_id) DO UPDATE SET last_read_sequence=excluded.last_read_sequence,updated_at=excluded.updated_at`).bind(id,responderId,Number(latest?.sequence??0),new Date().toISOString()).run();}
async function authorizeCustomer(db:D1Database,id:string,token:string|null){if(!token)throw new NativeChatError(401,"conversation_access_required","Conversation access is required");const authorization=await resolveConversationResumeToken(db,token);if(!authorization||authorization.conversationId!==id)throw new NativeChatError(403,"conversation_access_denied","Conversation access was denied");return authorization;}
async function requireConversation(db:D1Database,id:string){if(!await db.prepare("SELECT id FROM conversations WHERE id=?").bind(id).first())throw new NativeChatError(404,"conversation_not_found","Conversation not found");}
async function persistThroughRoom(env:Env,id:string,payload:object){const response=await room(env,id).fetch(`https://chat-room/message?conversationId=${encodeURIComponent(id)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});if(!response.ok)throw new NativeChatError(response.status,"message_not_saved","The message could not be saved");return response.json<{message:unknown;continuity?:{status:string}}>();}
function room(env:Env,id:string){if(!env.CHAT_ROOMS)throw new NativeChatError(503,"chat_unavailable","Chat is temporarily unavailable");return env.CHAT_ROOMS.getByName(id);}
async function enforceChatRateLimit(request:Request,env:Env,scope:string){if(!env.CHAT_RATE_LIMITER){if(env.ENVIRONMENT!=="development")throw new NativeChatError(503,"chat_unavailable","Chat is temporarily unavailable");return;}const ip=request.headers.get("CF-Connecting-IP")??"unknown";if(!(await env.CHAT_RATE_LIMITER.limit({key:`${scope}:${ip}`})).success)throw new NativeChatError(429,"rate_limited","Please wait before sending another message");}

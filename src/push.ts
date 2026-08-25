import webpush from "web-push";
import { z } from "zod";
import type { StaffIdentity } from "./auth";
import { resolveClientBusinessProfile } from "../business-profiles.mts";

const subscriptionSchema=z.object({
  endpoint:z.string().url().max(2048).refine((value)=>new URL(value).protocol==="https:","A secure push endpoint is required"),
  expirationTime:z.number().nullable().optional(),
  keys:z.object({p256dh:z.string().min(40).max(512),auth:z.string().min(8).max(256)}).strict(),
}).strict();
const endpointSchema=z.object({endpoint:z.string().url().max(2048)}).strict();
const activitySchema=endpointSchema.extend({foreground:z.boolean()}).strict();

type PushEvent={id:string;type:string;conversationId:string;sequence:number;senderKind:string;assignedResponderId:string|null;createdAt:string};
type SubscriptionRow={id:string;responder_id:string;endpoint:string;p256dh:string;auth:string};
type PushPayload={type:"live_chat"|"message"|"async_message"|"test";conversationId?:string;title:string;body:string;url:string;badge:number};
export type PushSender=(subscription:webpush.PushSubscription,payload:string,options:webpush.RequestOptions)=>Promise<{statusCode:number}>;

export async function handlePushApi(request:Request,env:Env,path:string,actor:StaffIdentity):Promise<Response|null>{
  if(path==="/v1/internal/push/config"&&request.method==="GET"){
    const count=await env.DB.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE responder_id=? AND enabled=1").bind(actor.id).first<{count:number}>();
    return Response.json({ok:true,configured:Boolean(env.VAPID_PUBLIC_KEY),publicKey:env.VAPID_PUBLIC_KEY??null,subscriptionCount:Number(count?.count??0)},{headers:{"Cache-Control":"no-store"}});
  }
  if(path==="/v1/internal/push/subscriptions"&&request.method==="PUT"){
    if(!env.VAPID_PUBLIC_KEY)return unavailable();
    const parsed=subscriptionSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return invalid("Invalid push subscription");
    if(!safePushEndpoint(parsed.data.endpoint))return invalid("Unsupported push endpoint");
    const now=new Date().toISOString();const id=crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO push_subscriptions (id,responder_id,endpoint,p256dh,auth,enabled,active_until,created_at,updated_at)
      VALUES (?,?,?,?,?,1,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET responder_id=excluded.responder_id,p256dh=excluded.p256dh,auth=excluded.auth,enabled=1,active_until=excluded.active_until,updated_at=excluded.updated_at,last_failure_code=NULL`)
      .bind(id,actor.id,parsed.data.endpoint,parsed.data.keys.p256dh,parsed.data.keys.auth,now,now,now).run();
    const row=await env.DB.prepare("SELECT id FROM push_subscriptions WHERE endpoint=? AND responder_id=?").bind(parsed.data.endpoint,actor.id).first<{id:string}>();
    return Response.json({ok:true,subscriptionId:row?.id??id},{status:201,headers:{"Cache-Control":"no-store"}});
  }
  if(path==="/v1/internal/push/subscriptions"&&request.method==="DELETE"){
    const parsed=endpointSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return invalid("Invalid push subscription");
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND responder_id=?").bind(parsed.data.endpoint,actor.id).run();
    return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
  }
  if(path==="/v1/internal/push/activity"&&request.method==="POST"){
    const parsed=activitySchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return invalid("Invalid push activity state");
    const now=new Date();const activeUntil=parsed.data.foreground?new Date(now.getTime()+45_000).toISOString():now.toISOString();
    const result=await env.DB.prepare("UPDATE push_subscriptions SET active_until=?,updated_at=? WHERE endpoint=? AND responder_id=? AND enabled=1").bind(activeUntil,now.toISOString(),parsed.data.endpoint,actor.id).run();
    if(Number(result.meta.changes)===0)return Response.json({ok:false,error:{code:"subscription_not_found",message:"Push subscription not found"}},{status:404});
    return Response.json({ok:true,activeUntil},{headers:{"Cache-Control":"no-store"}});
  }
  if(path==="/v1/internal/push/status"&&request.method==="POST"){
    const parsed=endpointSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return invalid("Invalid push subscription");
    const row=await env.DB.prepare(`SELECT enabled,active_until,last_success_at,last_failure_at,last_failure_code
      FROM push_subscriptions WHERE endpoint=? AND responder_id=?`).bind(parsed.data.endpoint,actor.id).first<{enabled:number;active_until:string|null;last_success_at:string|null;last_failure_at:string|null;last_failure_code:string|null}>();
    return Response.json({ok:true,registered:Boolean(row),enabled:row?.enabled===1,activeUntil:row?.active_until??null,lastSuccessAt:row?.last_success_at??null,lastFailureAt:row?.last_failure_at??null,lastFailureCode:row?.last_failure_code??null},{headers:{"Cache-Control":"no-store"}});
  }
  if(path==="/v1/internal/push/test"&&request.method==="POST"){
    const parsed=endpointSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return invalid("Invalid push subscription");
    const result=await sendTestNotification(env,actor.id,parsed.data.endpoint);
    return Response.json(result.body,{status:result.status,headers:{"Cache-Control":"no-store"}});
  }
  return null;
}

export async function sendTestNotification(env:Env,responderId:string,endpoint:string,send:PushSender=sendWebPush):Promise<{status:number;body:Record<string,unknown>}>{
  if(!configured(env))return{status:503,body:{ok:false,error:{code:"push_not_configured",message:"Staff notifications are not configured"}}};
  const row=await env.DB.prepare("SELECT id,responder_id,endpoint,p256dh,auth FROM push_subscriptions WHERE endpoint=? AND responder_id=? AND enabled=1").bind(endpoint,responderId).first<SubscriptionRow>();
  if(!row)return{status:404,body:{ok:false,error:{code:"subscription_not_found",message:"This device is not registered for notifications"}}};
  const profile=resolveClientBusinessProfile(env.BUSINESS_PROFILE);const payload:PushPayload={type:"test",title:`${profile.shortName} test notification`,body:"Server push notifications are working.",url:"/#/settings",badge:await unreadConversationCount(env.DB,responderId)};
  try{
    const response=await send({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify(payload),{
      vapidDetails:{subject:env.VAPID_SUBJECT!,publicKey:env.VAPID_PUBLIC_KEY!,privateKey:env.VAPID_PRIVATE_KEY!},TTL:60,urgency:"normal",topic:`${profile.pushTopicPrefix}-push-test`,
    });
    const completed=new Date().toISOString();await env.DB.prepare("UPDATE push_subscriptions SET last_success_at=?,last_failure_at=NULL,last_failure_code=NULL WHERE id=?").bind(completed,row.id).run();
    return{status:200,body:{ok:true,status:"delivered",acceptedStatus:response.statusCode,deliveredAt:completed}};
  }catch(error){
    const status=pushStatus(error);const completed=new Date().toISOString();const dead=status===404||status===410;
    await env.DB.prepare("UPDATE push_subscriptions SET enabled=?,last_failure_at=?,last_failure_code=? WHERE id=?").bind(dead?0:1,completed,status?String(status):"delivery_error",row.id).run();
    return{status:502,body:{ok:false,error:{code:"push_delivery_failed",message:"The push service rejected the test notification"},deliveryStatus:status,failedAt:completed}};
  }
}

export async function dispatchPushEvent(env:Env,event:PushEvent,send:PushSender=sendWebPush):Promise<void>{
  if(event.senderKind!=="customer"||!resolveClientBusinessProfile(env.BUSINESS_PROFILE).capabilities.opsNotifyPush||!configured(env))return;
  const now=new Date().toISOString();const routing=await routeResponders(env.DB,event.assignedResponderId,now);if(!routing.responderIds.length)return;
  const placeholders=routing.responderIds.map(()=>"?").join(",");
  const rows=await env.DB.prepare(`SELECT id,responder_id,endpoint,p256dh,auth FROM push_subscriptions
    WHERE enabled=1 AND responder_id IN (${placeholders}) AND (active_until IS NULL OR active_until<=?)`).bind(...routing.responderIds,now).all<SubscriptionRow>();
  const notificationType=event.sequence===1?(routing.hasAvailable?"live_chat":"async_message"):"message";
  await Promise.all(rows.results.map(async(row)=>{
    const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO push_deliveries (event_id,subscription_id,conversation_id,notification_type,status,attempted_at)
      VALUES (?,?,?,?,'pending',?)`).bind(event.id,row.id,event.conversationId,notificationType,now).run();
    if(Number(inserted.meta.changes)===0)return;
    const badge=await unreadConversationCount(env.DB,row.responder_id);const profile=resolveClientBusinessProfile(env.BUSINESS_PROFILE);const payload=pushPayload(notificationType,event.conversationId,badge,profile);
    try{
      const response=await send({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify(payload),{
        vapidDetails:{subject:env.VAPID_SUBJECT!,publicKey:env.VAPID_PUBLIC_KEY!,privateKey:env.VAPID_PRIVATE_KEY!},
        TTL:notificationType==="async_message"?3600:300,urgency:notificationType==="async_message"?"normal":"high",topic:topic(event.conversationId,profile.pushTopicPrefix),
      });
      const completed=new Date().toISOString();await env.DB.batch([
        env.DB.prepare("UPDATE push_deliveries SET status='sent',response_status=?,completed_at=? WHERE event_id=? AND subscription_id=?").bind(response.statusCode,completed,event.id,row.id),
        env.DB.prepare("UPDATE push_subscriptions SET last_success_at=?,last_failure_at=NULL,last_failure_code=NULL WHERE id=?").bind(completed,row.id),
      ]);
    }catch(error){
      const status=pushStatus(error);const completed=new Date().toISOString();const dead=status===404||status===410;
      await env.DB.batch([
        env.DB.prepare("UPDATE push_deliveries SET status='failed',response_status=?,completed_at=? WHERE event_id=? AND subscription_id=?").bind(status,completed,event.id,row.id),
        env.DB.prepare("UPDATE push_subscriptions SET enabled=?,last_failure_at=?,last_failure_code=? WHERE id=?").bind(dead?0:1,completed,status?String(status):"delivery_error",row.id),
      ]);
      console.warn(JSON.stringify({message:"staff push delivery failed",subscriptionId:row.id,status,dead}));
    }
  }));
}

async function routeResponders(db:D1Database,assignedResponderId:string|null,now:string){
  if(assignedResponderId)return{responderIds:[assignedResponderId],hasAvailable:false};
  const available=await db.prepare(`SELECT r.id FROM responders r JOIN responder_presence p ON p.responder_id=r.id
    WHERE r.active=1 AND p.available=1 AND p.expires_at>? ORDER BY r.id`).bind(now).all<{id:string}>();
  if(available.results.length)return{responderIds:available.results.map((row)=>row.id),hasAvailable:true};
  const fallback=await db.prepare("SELECT id FROM responders WHERE active=1 AND role IN ('admin','manager') ORDER BY id").all<{id:string}>();
  if(fallback.results.length)return{responderIds:fallback.results.map((row)=>row.id),hasAvailable:false};
  const active=await db.prepare("SELECT id FROM responders WHERE active=1 ORDER BY id").all<{id:string}>();
  return{responderIds:active.results.map((row)=>row.id),hasAvailable:false};
}
async function unreadConversationCount(db:D1Database,responderId:string){const row=await db.prepare(`SELECT COUNT(*) AS count FROM conversations cv WHERE EXISTS (
  SELECT 1 FROM conversation_messages cm WHERE cm.conversation_id=cv.id AND cm.sender_kind='customer' AND cm.sequence>COALESCE((SELECT cr.last_read_sequence FROM conversation_reads cr WHERE cr.conversation_id=cv.id AND cr.responder_id=?),0))`).bind(responderId).first<{count:number}>();return Number(row?.count??0);}
function pushPayload(type:"live_chat"|"message"|"async_message",conversationId:string,badge:number,profile=resolveClientBusinessProfile("focus")):PushPayload{return{
  type,conversationId,title:type==="live_chat"?`New ${profile.shortName} live chat`:`New ${profile.shortName} message`,
  body:type==="live_chat"?"A customer is waiting for a reply.":type==="async_message"?"A customer sent a message. Open Operations to respond.":"Open Operations to respond.",
  url:`/#/chat?conversation=${encodeURIComponent(conversationId)}`,badge,
};}
async function sendWebPush(subscription:webpush.PushSubscription,payload:string,options:webpush.RequestOptions){return webpush.sendNotification(subscription,payload,options);}
function configured(env:Env){return Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);}
function pushStatus(error:unknown){return error instanceof webpush.WebPushError?error.statusCode:typeof error==="object"&&error&&"statusCode" in error&&typeof error.statusCode==="number"?error.statusCode:null;}
function topic(conversationId:string,prefix="fl"){return `${prefix}-${conversationId.replace(/[^A-Za-z0-9_-]/g,"").slice(-28)}`.slice(0,32);}
function safePushEndpoint(value:string){const url=new URL(value);const hostname=url.hostname.toLowerCase();if(hostname==="localhost"||hostname.endsWith(".localhost"))return false;if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname))return false;return url.protocol==="https:"&&hostname.includes(".");}
function invalid(message:string){return Response.json({ok:false,error:{code:"validation_error",message}},{status:422});}
function unavailable(){return Response.json({ok:false,error:{code:"push_not_configured",message:"Staff notifications are not configured"}},{status:503});}

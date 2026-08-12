import { env,exports } from "cloudflare:workers";
import { beforeEach,describe,expect,it,vi } from "vitest";
import { notifyCustomerOfAbsentReply } from "../src/customer-continuity";
import { ResendCustomerNotificationEmailProvider,type ConversationReplyEmail,type CustomerNotificationEmailProvider } from "../src/customer-email";
import { hashResumeToken } from "../src/resume-tokens";

const token="development-test-token-00000000";const responder="rsp_continuity";
const auth={Authorization:`Bearer ${token}`,"X-Development-Responder-Id":responder,"Content-Type":"application/json"};
type Started={conversation:{id:string;resumeToken:string};message:{id:string;sequence:number}};

beforeEach(async()=>{const now=new Date().toISOString();await env.DB.prepare("INSERT INTO responders (id,display_label,active,created_at,updated_at) VALUES (?,?,?,?,?)").bind(responder,"Continuity Responder",1,now,now).run();});

async function start(email=`continuity-${crypto.randomUUID()}@example.test`){
  const response=await exports.default.fetch(new Request("https://operations.example.test/v1/chat/conversations",{method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":"192.0.2.81"},body:JSON.stringify({name:"Synthetic Customer",email,message:"Initial async customer message",clientMessageId:crypto.randomUUID(),website:""})}));
  expect(response.status).toBe(201);return response.json<Started>();
}
async function staffMessage(conversationId:string,sequence:number){const id=crypto.randomUUID();const now=new Date().toISOString();await env.DB.prepare("INSERT INTO conversation_messages VALUES (?,?,?,?,?,?,?,?)").bind(id,conversationId,crypto.randomUUID(),sequence,"responder",responder,`Staff reply ${sequence}`,now).run();return{id,sequence};}
function provider(calls:ConversationReplyEmail[],failure?:Error):CustomerNotificationEmailProvider{return{name:"test-email",async sendConversationReplyNotification(message){calls.push(message);if(failure)throw failure;return{providerMessageId:`provider-${calls.length}`};}};}

describe("customer email continuity",()=>{
  it("requires a deliverable email when starting an async conversation",async()=>{const response=await exports.default.fetch(new Request("https://operations.example.test/v1/chat/conversations",{method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":"192.0.2.82"},body:JSON.stringify({name:"No Email",message:"Missing email",clientMessageId:crypto.randomUUID(),website:""})}));expect(response.status).toBe(422);});
  it("sends one privacy-safe email while absent and stores only a hash of its capability token",async()=>{
    const created=await start();const calls:ConversationReplyEmail[]=[];const first=await staffMessage(created.conversation.id,2);
    expect(await notifyCustomerOfAbsentReply(env,created.conversation.id,first,false,provider(calls))).toMatchObject({status:"email_accepted"});
    const second=await staffMessage(created.conversation.id,3);expect(await notifyCustomerOfAbsentReply(env,created.conversation.id,second,false,provider(calls))).toMatchObject({status:"email_suppressed"});
    expect(calls).toHaveLength(1);expect(calls[0]!.resumeUrl).toMatch(/^https?:\/\/[^/]+\/conversation\/\?resume=[a-f0-9]{64}$/);
    const rawToken=new URL(calls[0]!.resumeUrl).searchParams.get("resume")!;expect(await env.DB.prepare("SELECT id FROM conversation_resume_tokens WHERE token_hash=?").bind(rawToken).first()).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM conversation_resume_tokens WHERE token_hash=?").bind(await hashResumeToken(rawToken)).first()).not.toBeNull();
    expect(JSON.stringify(calls[0])).not.toContain("Initial async customer message");expect(JSON.stringify(calls[0])).not.toContain("Staff reply");
  });
  it("accepts only the intended valid token, exposes public history only, and resets eligibility on resume",async()=>{
    const created=await start();const calls:ConversationReplyEmail[]=[];const first=await staffMessage(created.conversation.id,2);await notifyCustomerOfAbsentReply(env,created.conversation.id,first,false,provider(calls));
    await env.DB.prepare("INSERT INTO conversation_activity VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),created.conversation.id,"responder",responder,"internal_test_marker",JSON.stringify({secret:"never-public"}),new Date().toISOString()).run();
    const resumeToken=new URL(calls[0]!.resumeUrl).searchParams.get("resume")!;
    const alteredToken=resumeToken.slice(0,-1)+(resumeToken.endsWith("0")?"1":"0");
    const invalid=await exports.default.fetch(new Request("https://operations.example.test/v1/chat/resume",{headers:{"X-Chat-Resume-Token":alteredToken,"CF-Connecting-IP":"192.0.2.83"}}));expect(invalid.status).toBe(403);
    const valid=await exports.default.fetch(new Request("https://operations.example.test/v1/chat/resume",{headers:{"X-Chat-Resume-Token":resumeToken,"CF-Connecting-IP":"192.0.2.83"}}));expect(valid.status).toBe(200);
    const body=await valid.text();expect(body).toContain(created.conversation.id);expect(body).toContain("Initial async customer message");expect(body).toContain("Staff reply 2");expect(body).not.toContain("never-public");
    expect(await env.DB.prepare("SELECT cleared_at FROM conversation_notifications WHERE conversation_id=?").bind(created.conversation.id).first<string>("cleared_at")).toBeTruthy();
    const third=await staffMessage(created.conversation.id,3);await notifyCustomerOfAbsentReply(env,created.conversation.id,third,false,provider(calls));expect(calls).toHaveLength(2);
  });
  it("keeps the staff reply and records failure when the provider fails",async()=>{
    const created=await start();const reply=await staffMessage(created.conversation.id,2);const calls:ConversationReplyEmail[]=[];
    expect(await notifyCustomerOfAbsentReply(env,created.conversation.id,reply,false,provider(calls,new Error("provider down")))).toMatchObject({status:"email_failed"});
    expect(await env.DB.prepare("SELECT body FROM conversation_messages WHERE id=?").bind(reply.id).first<string>("body")).toBe("Staff reply 2");
    expect(await env.DB.prepare("SELECT status FROM conversation_notifications WHERE conversation_id=?").bind(created.conversation.id).first<string>("status")).toBe("failed");
    expect(await env.DB.prepare("SELECT revoked_at FROM conversation_resume_tokens WHERE conversation_id=?").bind(created.conversation.id).first<string>("revoked_at")).toBeTruthy();
  });
  it("does not notify while a customer is active",async()=>{const created=await start();const reply=await staffMessage(created.conversation.id,2);const calls:ConversationReplyEmail[]=[];expect(await notifyCustomerOfAbsentReply(env,created.conversation.id,reply,true,provider(calls))).toEqual({status:"customer_active"});expect(calls).toHaveLength(0);expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM conversation_notifications").first<number>("count")).toBe(0);});
  it("builds Resend transactional HTML and plain text without conversation history",async()=>{
    const fetcher=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{const request=JSON.parse(String(init?.body)) as Record<string,unknown>;expect(request).toMatchObject({subject:"Focus Lab replied to your message",to:["customer@example.test"]});expect(String(request.text)).toContain("Continue conversation: https://public.example.test/conversation/?resume=secret");expect(String(request.html)).toContain("Continue conversation");expect(JSON.stringify(request)).not.toContain("full history");return Response.json({id:"resend_test_id"});});
    const resend=new ResendCustomerNotificationEmailProvider("test-key","Focus Lab <replies@example.test>",fetcher as typeof fetch);
    await expect(resend.sendConversationReplyNotification({to:"customer@example.test",customerFirstName:"Casey",resumeUrl:"https://public.example.test/conversation/?resume=secret",idempotencyKey:"test-idempotency"})).resolves.toEqual({providerMessageId:"resend_test_id"});
  });
  it("keeps existing schema data through migration 0005",async()=>{const created=await start();expect(await env.DB.prepare("SELECT id FROM conversations WHERE id=?").bind(created.conversation.id).first<string>("id")).toBe(created.conversation.id);expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_notifications'").first<string>("name")).toBe("conversation_notifications");});
  it("keeps internal resume boundaries unauthenticated for customers but staff APIs protected",async()=>{const created=await start();expect((await exports.default.fetch(new Request(`https://operations.example.test/v1/internal/conversations/${created.conversation.id}`))).status).toBe(401);expect((await exports.default.fetch(new Request(`https://operations.example.test/v1/internal/conversations/${created.conversation.id}`,{headers:auth}))).status).toBe(200);});
});

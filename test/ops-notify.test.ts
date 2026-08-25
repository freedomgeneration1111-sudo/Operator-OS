import { env } from "cloudflare:workers";
import { describe,expect,it,vi } from "vitest";
import { dispatchOpsNotificationEmail } from "../src/ops-notify";

const configuredEnv={...env,RESEND_API_KEY:"test-key",CUSTOMER_EMAIL_FROM:"Focus Lab <replies@example.test>",OPS_NOTIFY_EMAIL:"ops@example.test",STAFF_CONSOLE_ORIGIN:"https://staff.example.test"} as typeof env;

async function seedConversation(options:{email?:string|null;replySms?:number;body?:string}={}){
  const now=new Date().toISOString();const contact=`con_${crypto.randomUUID()}`;const conversation=`cv_${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO contacts VALUES (?,?,?,?,?,?,?)").bind(contact,"Ops Test Customer",options.email===undefined?`${contact}@example.test`:options.email,"555-0100","email",now,now),
    env.DB.prepare(`INSERT INTO conversations (id,contact_id,provider,channel_state,reply_email,reply_sms,reply_call,created_at,updated_at) VALUES (?,?,'native_web','open',1,?,0,?,?)`).bind(conversation,contact,options.replySms??0,now,now),
    env.DB.prepare("INSERT INTO conversation_messages VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),conversation,crypto.randomUUID(),1,"customer",null,options.body??"Is anyone available?",now),
  ]);
  return conversation;
}
function event(conversationId:string,overrides:Record<string,unknown>={}){return{conversationId,sequence:1,senderKind:"customer",...overrides};}

describe("ops notification email",()=>{
  it("skips silently when Resend/ops-email config is absent, without throwing",async()=>{
    const conversation=await seedConversation();const fetcher=vi.fn();
    await expect(dispatchOpsNotificationEmail(env,event(conversation),fetcher as unknown as typeof fetch)).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("skips responder-authored messages",async()=>{
    const conversation=await seedConversation();const fetcher=vi.fn();
    await dispatchOpsNotificationEmail(configuredEnv,event(conversation,{senderKind:"responder"}),fetcher as unknown as typeof fetch);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends a Resend email with customer details, reply preferences, and a staff console deep link",async()=>{
    const conversation=await seedConversation({replySms:1,body:"Is anyone available?"});
    const fetcher=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      const request=JSON.parse(String(init?.body)) as Record<string,unknown>;
      expect(request).toMatchObject({from:"Focus Lab <replies@example.test>",to:["ops@example.test"]});
      expect(String(request.subject)).toContain("Ops Test Customer");
      expect(String(request.text)).toContain("Is anyone available?");
      expect(String(request.text)).toContain("555-0100");
      expect(String(request.text)).toContain("Email, Text");
      expect(String(request.text)).toContain(`https://staff.example.test/#/chat?conversation=${conversation}`);
      return Response.json({id:"resend_ops_test_id"});
    });
    await dispatchOpsNotificationEmail(configuredEnv,event(conversation),fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports a missing email as 'Not supplied' for WhatsApp-style contacts with no email on file",async()=>{
    const conversation=await seedConversation({email:null});
    const fetcher=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      const request=JSON.parse(String(init?.body)) as Record<string,unknown>;
      expect(String(request.text)).toContain("Email: Not supplied");
      return Response.json({id:"resend_ops_test_id"});
    });
    await dispatchOpsNotificationEmail(configuredEnv,event(conversation),fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("omits the deep link when STAFF_CONSOLE_ORIGIN is not configured",async()=>{
    const conversation=await seedConversation();
    const withoutOrigin={...configuredEnv,STAFF_CONSOLE_ORIGIN:undefined} as typeof env;
    const fetcher=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      const request=JSON.parse(String(init?.body)) as Record<string,unknown>;
      expect(String(request.text)).not.toContain("Open in staff console");
      return Response.json({id:"resend_ops_test_id"});
    });
    await dispatchOpsNotificationEmail(withoutOrigin,event(conversation),fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("throws when Resend rejects the notification, so the caller can log the failure",async()=>{
    const conversation=await seedConversation();
    const fetcher=vi.fn(async()=>new Response("rejected",{status:429}));
    await expect(dispatchOpsNotificationEmail(configuredEnv,event(conversation),fetcher as unknown as typeof fetch)).rejects.toThrow();
  });
});

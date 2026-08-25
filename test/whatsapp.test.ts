import { env } from "cloudflare:workers";
import { describe,expect,it } from "vitest";
import { handleWhatsAppWebhook,WhatsAppWebhookError } from "../src/whatsapp";

const ctx={waitUntil(){}} as unknown as ExecutionContext;
function request(body:string,signature?:string){
  const headers=signature?{"X-Hub-Signature-256":signature}:undefined;
  return new Request("https://example.test/v1/webhooks/whatsapp",{method:"POST",headers,body});
}

describe("whatsapp webhook, unconfigured tenant",()=>{
  it("returns a clean 503 instead of a bad-signature 401 when WHATSAPP_APP_SECRET is absent",async()=>{
    expect(env.WHATSAPP_APP_SECRET).toBeUndefined();
    await expect(handleWhatsAppWebhook(request("{}","sha256=irrelevant"),env,ctx)).rejects.toMatchObject({status:503,message:"WhatsApp is not configured for this deployment"});
  });
  it("still returns 401 for a genuinely bad signature once configured",async()=>{
    const configuredEnv={...env,WHATSAPP_APP_SECRET:"test-app-secret"} as typeof env;
    await expect(handleWhatsAppWebhook(request("{}","sha256=deadbeef"),configuredEnv,ctx)).rejects.toMatchObject({status:401,message:"Invalid webhook signature"});
  });
  it("both failure modes surface as WhatsAppWebhookError, not an unhandled crash",async()=>{
    await expect(handleWhatsAppWebhook(request("{}"),env,ctx)).rejects.toBeInstanceOf(WhatsAppWebhookError);
  });
});

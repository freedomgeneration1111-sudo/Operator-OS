import { env } from "cloudflare:workers";
import { describe,expect,it,vi } from "vitest";
import { sendOpsNotification } from "../src/ops-notify";

const notification={name:"Synthetic Visitor",email:"visitor@example.test",phone:"555-0100",message:"Is anyone available?",replyEmail:true,replySms:true,replyCall:false};

describe("ops notification",()=>{
  it("skips silently when Resend/ops-email config is absent, without throwing",async()=>{
    const fetcher=vi.fn();
    await expect(sendOpsNotification(env,notification,fetcher as unknown as typeof fetch)).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends a Resend email with customer details and reply preferences once configured",async()=>{
    const fetcher=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      const request=JSON.parse(String(init?.body)) as Record<string,unknown>;
      expect(request).toMatchObject({from:"Focus Lab <replies@example.test>",to:["ops@example.test"]});
      expect(String(request.subject)).toContain("Synthetic Visitor");
      expect(String(request.text)).toContain("Is anyone available?");
      expect(String(request.text)).toContain("visitor@example.test");
      expect(String(request.text)).toContain("555-0100");
      expect(String(request.text)).toContain("Email, Text");
      return Response.json({id:"resend_ops_test_id"});
    });
    const configuredEnv={...env,RESEND_API_KEY:"test-key",CUSTOMER_EMAIL_FROM:"Focus Lab <replies@example.test>",OPS_NOTIFY_EMAIL:"ops@example.test"} as typeof env;
    await sendOpsNotification(configuredEnv,notification,fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("throws when Resend rejects the notification, so the caller can log the failure",async()=>{
    const fetcher=vi.fn(async()=>new Response("rejected",{status:429}));
    const configuredEnv={...env,RESEND_API_KEY:"test-key",CUSTOMER_EMAIL_FROM:"Focus Lab <replies@example.test>",OPS_NOTIFY_EMAIL:"ops@example.test"} as typeof env;
    await expect(sendOpsNotification(configuredEnv,notification,fetcher as unknown as typeof fetch)).rejects.toThrow();
  });
});

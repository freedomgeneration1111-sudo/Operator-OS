import { describe,expect,it,vi } from "vitest";
import { enforceInquiryProtection,InquiryProtectionError } from "../src/inquiry-protection";

const request=()=>new Request("https://api.example.test/v1/inquiries",{headers:{"CF-Connecting-IP":"192.0.2.50"}});
const baseEnv=()=>({ENVIRONMENT:"staging",TURNSTILE_SECRET_KEY:"test-secret",INQUIRY_RATE_LIMITER:{limit:vi.fn().mockResolvedValue({success:true})}}) as unknown as Env;
const verifier=(body:object,status=200)=>vi.fn().mockResolvedValue(Response.json(body,{status})) as unknown as typeof fetch;

describe("public inquiry abuse protection",()=>{
  it("accepts a server-verified Turnstile token",async()=>{const env=baseEnv();const fetcher=verifier({success:true,hostname:"public.example.test",action:"inquiry_submit"});env.TURNSTILE_EXPECTED_HOSTNAME="public.example.test";await expect(enforceInquiryProtection(request(),env,{turnstileToken:"valid-token",website:""},fetcher)).resolves.toBeUndefined();expect(fetcher).toHaveBeenCalledOnce();expect(env.INQUIRY_RATE_LIMITER!.limit).toHaveBeenCalledOnce();});
  it("rejects missing or invalid Turnstile verification",async()=>{const env=baseEnv();await expect(enforceInquiryProtection(request(),env,{turnstileToken:"invalid",website:""},verifier({success:false,"error-codes":["invalid-input-response"]}))).rejects.toMatchObject({status:400,code:"verification_failed"});});
  it("fails closed when Siteverify is unavailable",async()=>{await expect(enforceInquiryProtection(request(),baseEnv(),{turnstileToken:"token",website:""},verifier({},503))).rejects.toMatchObject({status:503,code:"verification_unavailable"});});
  it("rejects a honeypot hit before Siteverify",async()=>{const fetcher=verifier({success:true});await expect(enforceInquiryProtection(request(),baseEnv(),{turnstileToken:"token",website:"spam.example"},fetcher)).rejects.toMatchObject({status:400,code:"submission_rejected"});expect(fetcher).not.toHaveBeenCalled();});
  it("returns 429 when the Worker rate-limit binding denies the request",async()=>{const env=baseEnv();env.INQUIRY_RATE_LIMITER={limit:vi.fn().mockResolvedValue({success:false})} as RateLimit;await expect(enforceInquiryProtection(request(),env,{turnstileToken:"token",website:""},verifier({success:true}))).rejects.toMatchObject({status:429,code:"rate_limited"});});
  it("fails closed without rate limiting outside development",async()=>{const env=baseEnv();delete env.INQUIRY_RATE_LIMITER;await expect(enforceInquiryProtection(request(),env,{turnstileToken:"token",website:""},verifier({success:true}))).rejects.toBeInstanceOf(InquiryProtectionError);});
});

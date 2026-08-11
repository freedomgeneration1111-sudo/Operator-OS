import { env,exports } from "cloudflare:workers";
import { describe,expect,it } from "vitest";
import { submitInquiryWithConfig } from "../../lib/operations-api";

describe("static website inquiry integration seam",() => {
  const submission = {
    eventType:"Wedding",date:"2027-09-14",location:"Dallas, TX",services:["Photo"],guests:"80",
    budget:"",name:"Synthetic Browser Customer",email:"browser@example.test",phone:"",contact:"email",note:"",turnstileToken:"test-turnstile-pass",website:"",
  };
  it("fails truthfully while disabled",async () => {
    await expect(submitInquiryWithConfig(submission,"client-disabled-0001",{ apiUrl:"",enabled:false })).rejects.toThrow("not configured");
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM inquiries").first<number>("count")).toBe(0);
  });
  it("sanitizes browser network exceptions",async () => {
    await expect(submitInquiryWithConfig(submission,"client-network-0001",{apiUrl:"https://api.example.test",enabled:true},async()=>{throw new TypeError("NetworkError when attempting to fetch resource.");})).rejects.toThrow("We couldn't send your inquiry. Please try again. Your information has been kept on this page.");
  });
  it("persists through the configured client-to-Worker contract",async () => {
    const result = await submitInquiryWithConfig(
      submission,"client-enabled-0001",{ apiUrl:"https://operations.example.test",enabled:true },
      (input,init) => exports.default.fetch(new Request(input,init)),
    );
    expect(result.status).toBe("received_for_review");
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM inquiries WHERE id=?").bind(result.inquiryId).first<number>("count")).toBe(1);
  });
});

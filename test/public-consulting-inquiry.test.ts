import { env,exports } from "cloudflare:workers";
import { afterEach,beforeEach,describe,expect,it } from "vitest";

const previousProfile=env.BUSINESS_PROFILE;
const previousPublicApi=env.PUBLIC_API_ENABLED;
const origin="http://localhost:3000";
const valid={
  name:"Synthetic Consulting Lead",
  email:"consulting-public@example.test",
  organization:"Synthetic Studio",
  situationProblem:"Customer inquiries are split across tools and important context disappears.",
  preferredContact:"email",
  source:"website_consulting",
  landingPage:"https://mosesjorgensen.com/field-notes/customer-interface/",
  referrer:"https://example.test/referral",
  utmSource:"outreach",
  utmMedium:"email",
  utmCampaign:"systems-architecture",
  firstTouchCapturedAt:"2026-08-24T20:15:00.000Z",
  currentPage:"/contact/?utm_source=follow-up",
  currentUtmSource:"follow-up",
  currentUtmMedium:"direct-message",
  currentUtmCampaign:"diagnostic-review",
  pageType:"contact",
  contentSlug:"customer-interface",
  turnstileToken:"test-turnstile-pass",
  website:"",
};
const submit=(body:unknown,key="consulting-public-key-0001")=>exports.default.fetch(new Request("https://operations.example.test/v1/inquiries",{
  method:"POST",
  headers:{"Content-Type":"application/json","Idempotency-Key":key,Origin:origin,"CF-Connecting-IP":"192.0.2.201"},
  body:JSON.stringify(body),
}));

beforeEach(()=>{env.BUSINESS_PROFILE="moses";env.PUBLIC_API_ENABLED="true";});
afterEach(()=>{env.BUSINESS_PROFILE=previousProfile;env.PUBLIC_API_ENABLED=previousPublicApi;});

describe("Moses public consulting inquiry",()=>{
  it("creates an eventless structured inquiry with provenance",async()=>{
    const response=await submit(valid);
    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    const result=await response.json<{inquiryId:string;eventId:null;message:string}>();
    expect(result.eventId).toBeNull();
    expect(result.message).toContain("I review every inquiry personally");
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM events").first<number>("count")).toBe(0);
    expect(await env.DB.prepare("SELECT organization FROM consulting_details WHERE inquiry_id=?").bind(result.inquiryId).first<string>("organization")).toBe("Synthetic Studio");
    const intake=await env.DB.prepare("SELECT landing_page,utm_source,utm_medium,utm_campaign,captured_at,payload_json FROM intake_submissions WHERE inquiry_id=?").bind(result.inquiryId).first<Record<string,unknown>>();
    expect(intake).toMatchObject({landing_page:valid.landingPage,utm_source:"outreach",utm_medium:"email",utm_campaign:"systems-architecture",captured_at:valid.firstTouchCapturedAt});
    const persistedPayload=JSON.parse(String(intake?.payload_json)) as Record<string,unknown>;
    expect(persistedPayload).toMatchObject({
      currentPage:valid.currentPage,
      currentUtmSource:"follow-up",
      currentUtmMedium:"direct-message",
      currentUtmCampaign:"diagnostic-review",
      pageType:"contact",
      contentSlug:"customer-interface",
    });
    expect(persistedPayload).not.toHaveProperty("turnstileToken");
    expect(persistedPayload).not.toHaveProperty("website");
  });
  it("rejects event-specific payloads for the Moses profile",async()=>{
    const response=await submit({...valid,eventType:"Wedding",date:"2027-06-10"},"consulting-public-key-0002");
    expect(response.status).toBe(422);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM inquiries").first<number>("count")).toBe(0);
  });
  it("idempotently replays retries without duplicating the CRM record",async()=>{
    expect((await submit(valid,"consulting-public-key-0003")).status).toBe(201);
    const replay=await submit(valid,"consulting-public-key-0003");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({idempotentReplay:true});
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM inquiries").first<number>("count")).toBe(1);
  });
});

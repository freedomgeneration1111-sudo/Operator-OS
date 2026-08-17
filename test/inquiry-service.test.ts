import { env,exports } from "cloudflare:workers";
import { beforeEach,describe,expect,it } from "vitest";
import { consultingInquirySchema } from "../src/contracts";
import { createConsultingInquiry } from "../src/inquiry-adapters";
import { listInquiries } from "../src/repository";

const now="2026-08-17T18:00:00.000Z";
const consulting=consultingInquirySchema.parse({
  name:"Synthetic Consulting Lead",email:"consulting@example.test",preferredContact:"email",
  organization:"Synthetic Advisory LLC",offerServiceArea:"Go-to-market strategy",
  situationProblem:"The offer is strong but market entry is fragmented.",
  desiredOutcome:"A focused penetration plan and operating cadence.",timeline:"This quarter",
  budget:"Planning range",countryRegion:"United States",referralSource:"Trusted referral",
  source:"website_consulting",landingPage:"https://example.test/advisory",referrer:"https://referrer.example.test/",
  utmSource:"newsletter",utmMedium:"email",utmCampaign:"market-entry",
});
const token="development-test-token-00000000";
const auth={Authorization:`Bearer ${token}`,"X-Development-Responder-Id":"rsp_consulting","Content-Type":"application/json"};
const api=(path:string,init:RequestInit={})=>exports.default.fetch(new Request(`https://operations.example.test${path}`,{...init,headers:{...auth,...init.headers}}));

beforeEach(async()=>{
  await env.DB.prepare("INSERT INTO responders (id,display_label,active,created_at,updated_at) VALUES (?,?,?,?,?)")
    .bind("rsp_consulting","Consulting Responder",1,now,now).run();
});

describe("generic inquiry application service",()=>{
  it("creates and idempotently replays an eventless consulting inquiry with provenance and attribution",async()=>{
    const created=await createConsultingInquiry(env.DB,consulting,"consulting-idempotency-0001",now);
    expect(created.eventId).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM events").first<number>("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM consulting_details WHERE inquiry_id=?").bind(created.inquiryId).first<number>("count")).toBe(1);
    const intake=await env.DB.prepare("SELECT * FROM intake_submissions WHERE inquiry_id=?").bind(created.inquiryId).first<Record<string,unknown>>();
    expect(intake).toMatchObject({form_schema_key:"moses.website.consulting-inquiry",schema_version:1,origin:"moses_public_website",utm_campaign:"market-entry",referral:"Trusted referral"});
    expect(String(intake?.payload_json)).not.toContain("turnstile");
    expect(String(intake?.payload_json)).not.toContain("website\":\"spam");

    const replay=await createConsultingInquiry(env.DB,consulting,"consulting-idempotency-0001",now);
    expect(replay).toMatchObject({inquiryId:created.inquiryId,eventId:null,idempotentReplay:true});
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM consulting_details").first<number>("count")).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM intake_submissions").first<number>("count")).toBe(1);
  });

  it("lists, searches, details, and mutates an eventless consulting inquiry",async()=>{
    const created=await createConsultingInquiry(env.DB,consulting,"consulting-idempotency-0002",now);
    expect((await listInquiries(env.DB,null)).map((row)=>row.id)).toContain(created.inquiryId);
    expect((await listInquiries(env.DB,"market entry")).map((row)=>row.id)).toContain(created.inquiryId);
    const inbox=await (await api("/v1/internal/inbox?query=Synthetic%20Advisory")).json<{inquiries:Array<{id:string;event_id:null;organization:string}>}>();
    expect(inbox.inquiries).toEqual([expect.objectContaining({id:created.inquiryId,event_id:null,organization:"Synthetic Advisory LLC"})]);
    const detail=await (await api(`/v1/internal/inquiries/${created.inquiryId}`)).json<{event:null;consulting:{organization:string}}>();
    expect(detail).toMatchObject({event:null,consulting:{organization:"Synthetic Advisory LLC"}});

    expect((await api(`/v1/internal/inquiries/${created.inquiryId}/workflow`,{method:"PATCH",body:JSON.stringify({state:"reviewing"})})).status).toBe(200);
    expect((await api(`/v1/internal/inquiries/${created.inquiryId}/assignment`,{method:"PATCH",body:JSON.stringify({responderId:"rsp_consulting",assigned:true})})).status).toBe(200);
    expect((await api(`/v1/internal/inquiries/${created.inquiryId}/notes`,{method:"POST",body:JSON.stringify({body:"Consulting follow-up"})})).status).toBe(201);
    expect((await api(`/v1/internal/inquiries/${created.inquiryId}/capacity`,{method:"PATCH",body:JSON.stringify({blocksCapacity:true})})).status).toBe(409);
    expect((await api(`/v1/internal/inquiries/${created.inquiryId}/conflicts`)).status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM activities WHERE inquiry_id=? AND event_id IS NULL").bind(created.inquiryId).first<number>("count")).toBe(4);
  });
});

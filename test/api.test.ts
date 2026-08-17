import { env,exports } from "cloudflare:workers";
const SELF=exports.default;
import { beforeEach,describe,expect,it } from "vitest";

const validInquiry = {
  eventType: "Wedding",date: "2027-06-10",location: "Dallas, TX",services: ["Photo","Video"],
  guests: "150",budget: "Not sure yet",name: "Synthetic Customer",email: "synthetic@example.test",
  phone: "",contact: "email",note: "Synthetic test inquiry",turnstileToken:"test-turnstile-pass",website:"",
};

const publicOrigin="http://localhost:3000";
function expectPublicCors(response:Response){
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(publicOrigin);
  expect(response.headers.get("Vary")).toContain("Origin");
}

const inquiryRequest = (body: unknown,key = "test-key-00000001") => new Request("https://operations.example.test/v1/inquiries",{
  method: "POST",headers: { "Content-Type": "application/json","Idempotency-Key": key,"Origin":publicOrigin,"CF-Connecting-IP": `192.0.2.${Math.abs([...key].reduce((sum,char)=>sum+char.charCodeAt(0),0))%250+1}` },body: JSON.stringify(body),
});

beforeEach(async () => {
  await env.DB.prepare("INSERT INTO responders (id,display_label,active,created_at,updated_at) VALUES (?,?,?,?,?)")
    .bind("responder-test","Synthetic responder",1,"2026-01-01T00:00:00.000Z","2026-01-01T00:00:00.000Z").run();
});

describe("POST /v1/inquiries",() => {
  it("answers the exact browser preflight",async()=>{const response=await SELF.fetch("https://operations.example.test/v1/inquiries",{method:"OPTIONS",headers:{Origin:publicOrigin,"Access-Control-Request-Method":"POST","Access-Control-Request-Headers":"content-type,idempotency-key"}});expect(response.status).toBe(204);expectPublicCors(response);expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");expect(response.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain("content-type");expect(response.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain("idempotency-key");});
  it("persists a valid contact, event, inquiry, services and activity",async () => {
    const response = await SELF.fetch(inquiryRequest(validInquiry));
    expect(response.status).toBe(201);
    expectPublicCors(response);
    const body = await response.json<{ inquiryId: string;status: string }>();
    expect(body.status).toBe("received_for_review");
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM inquiries").first<number>("count")).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM inquiry_services").first<number>("count")).toBe(2);
    expect(await env.DB.prepare("SELECT blocks_capacity FROM events WHERE id=(SELECT event_id FROM inquiries WHERE id=?)").bind(body.inquiryId).first<number>("blocks_capacity")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM intake_submissions WHERE inquiry_id=?").bind(body.inquiryId).first<number>("count")).toBe(1);
  });
  it("rejects missing required fields with CORS",async () => {const response=await SELF.fetch(inquiryRequest({ name: "Only name" }));expect(response.status).toBe(422);expectPublicCors(response);});
  it("rejects malformed fields",async () => expect((await SELF.fetch(inquiryRequest({ ...validInquiry,email: "not-email" }))).status).toBe(422));
  it("rejects a missing Turnstile token",async () => { const body={...validInquiry,turnstileToken:undefined};expect((await SELF.fetch(inquiryRequest(body,"missing-turnstile-01"))).status).toBe(422); });
  it("rejects an invalid Turnstile token with CORS",async () => {const response=await SELF.fetch(inquiryRequest({ ...validInquiry,turnstileToken:"invalid" },"invalid-turnstile-01"));expect(response.status).toBe(400);expectPublicCors(response);});
  it("rejects a honeypot hit without persistence",async () => { const response=await SELF.fetch(inquiryRequest({ ...validInquiry,website:"spam.example" },"honeypot-key-00001"));expect(response.status).toBe(400);expectPublicCors(response);expect(await env.DB.prepare("SELECT COUNT(*) count FROM inquiries").first<number>("count")).toBe(0); });
  it("rejects unexpected fields",async () => expect((await SELF.fetch(inquiryRequest({ ...validInquiry,isAdmin: true }))).status).toBe(422));
  it("deduplicates retries by idempotency key",async () => {
    expect((await SELF.fetch(inquiryRequest(validInquiry,"repeat-key-00000001"))).status).toBe(201);
    const replay = await SELF.fetch(inquiryRequest(validInquiry,"repeat-key-00000001"));
    expect(replay.status).toBe(200);
    expect((await replay.json<{ idempotentReplay: boolean }>()).idempotentReplay).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM inquiries").first<number>("count")).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM events").first<number>("count")).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM inquiry_services").first<number>("count")).toBe(2);
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM intake_submissions").first<number>("count")).toBe(1);
    const payload=await env.DB.prepare("SELECT payload_json FROM intake_submissions").first<string>("payload_json");
    expect(payload).not.toContain("turnstileToken");
    expect(payload).not.toContain("website");
  });
  it("supports a multi-day date range",async () => {
    const response = await SELF.fetch(inquiryRequest({ ...validInquiry,endDate: "2027-06-12" },"multi-day-00000001"));
    expect(response.status).toBe(201);
    expect(await env.DB.prepare("SELECT end_date FROM events").first<string>("end_date")).toBe("2027-06-12");
  });
  it("returns a safe error when the database fails",async () => {
    await env.DB.prepare("ALTER TABLE inquiries RENAME TO inquiries_unavailable").run();
    const response = await SELF.fetch(inquiryRequest(validInquiry,"db-fail-key-000001"));
    expect(response.status).toBe(500);
    expectPublicCors(response);
    const body = await response.json<{ error: { code: string;message: string } }>();
    expect(body.error).toEqual({ code: "internal_error",message: "The operation could not be completed" });
    await env.DB.prepare("ALTER TABLE inquiries_unavailable RENAME TO inquiries").run();
  });
});

describe("chat status and responder presence",() => {
  const status = () => SELF.fetch("https://operations.example.test/v1/chat/status");
  const heartbeat = (responderId: string,available: boolean,token = "development-test-token-00000000") => SELF.fetch("https://operations.example.test/v1/internal/presence/heartbeat",{
    method: "POST",headers: { "Content-Type": "application/json",Authorization: `Bearer ${token}`,"X-Development-Responder-Id": responderId },body: JSON.stringify({ available }),
  });
  it("returns async with no current responder",async () => await expect((await status()).json()).resolves.toMatchObject({ state: "async",label: "Send us a Message" }));
  it("returns live with one or multiple current responders",async () => {
    expect((await heartbeat("responder-test",true)).status).toBe(200);
    await expect((await status()).json()).resolves.toMatchObject({ state: "live",label: "Live Chat" });
    await env.DB.prepare("INSERT INTO responders (id,display_label,active,created_at,updated_at) VALUES (?,?,?,?,?)").bind("responder-two","Second synthetic responder",1,"2026-01-01T00:00:00.000Z","2026-01-01T00:00:00.000Z").run();
    await heartbeat("responder-two",true);
    await expect((await status()).json()).resolves.toMatchObject({ state: "live" });
  });
  it("falls back to async after the last heartbeat expires",async () => {
    await heartbeat("responder-test",true);
    await env.DB.prepare("UPDATE responder_presence SET expires_at=?").bind("2000-01-01T00:00:00.000Z").run();
    await expect((await status()).json()).resolves.toMatchObject({ state: "async" });
  });
  it("rejects unauthorized heartbeats",async () => expect((await heartbeat("responder-test",true,"wrong-token")).status).toBe(401));
  it("keeps native async chat available without an external destination",async () => {
    const original = env.MESSAGING_DESTINATION_URL;
    env.MESSAGING_DESTINATION_URL = "";
    await expect((await status()).json()).resolves.toMatchObject({ state: "async",destinationUrl: null });
    env.MESSAGING_DESTINATION_URL = original;
  });
});

describe("protected CRM API and database integrity",() => {
  it("applies migrations and enforces foreign keys",async () => {
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM d1_migrations").first<number>("count")).toBe(6);
    await expect(env.DB.prepare("INSERT INTO inquiry_services VALUES (?,?)").bind("missing","Photo").run()).rejects.toThrow();
  });
  it("does not expose CRM enumeration publicly",async () => {
    const response = await SELF.fetch("https://operations.example.test/v1/internal/inquiries");
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("synthetic@example.test");
  });
  it("supports protected list and detail endpoints",async () => {
    const created = await SELF.fetch(inquiryRequest(validInquiry,"crm-list-key-00001"));
    const id = (await created.json<{ inquiryId: string }>()).inquiryId;
    const headers = { Authorization: "Bearer development-test-token-00000000","X-Development-Responder-Id": "responder-test" };
    expect((await SELF.fetch("https://operations.example.test/v1/internal/inquiries",{ headers })).status).toBe(200);
    const detail = await SELF.fetch(`https://operations.example.test/v1/internal/inquiries/${id}`,{ headers });
    expect(detail.status).toBe(200);
    expect(await detail.text()).not.toContain("INTERNAL_API_TOKEN");
  });
});

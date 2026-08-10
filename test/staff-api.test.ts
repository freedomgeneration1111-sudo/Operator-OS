import { env,exports } from "cloudflare:workers";
import { beforeEach,describe,expect,it } from "vitest";

const token="development-test-token-00000000";
const auth={ Authorization:`Bearer ${token}` };
const responderA="rsp_staff_a";
const responderB="rsp_staff_b";
async function api(path:string,init:RequestInit={}){return exports.default.fetch(new Request(`https://operations.example.test${path}`,{...init,headers:{...auth,"Content-Type":"application/json",...init.headers}}));}

beforeEach(async()=>{
  const now="2026-08-10T12:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO responders VALUES (?,?,?,?,?)").bind(responderA,"Test Responder A",1,now,now),
    env.DB.prepare("INSERT INTO responders VALUES (?,?,?,?,?)").bind(responderB,"Test Responder B",1,now,now),
    env.DB.prepare("INSERT INTO contacts VALUES (?,?,?,?,?,?,?)").bind("con_staff","Synthetic Staff Test","staff.customer@example.test",null,"email",now,now),
    env.DB.prepare("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind("evt_staff","Wedding","2027-06-10","2027-06-10","18:00","22:00","Synthetic Venue",100,0,"requested",now,now),
    env.DB.prepare("INSERT INTO inquiries VALUES (?,?,?,?,?,?,?,?,?,?)").bind("inq_staff","con_staff","evt_staff","test","new",null,"Synthetic note","staff-api-idempotency",now,now),
    env.DB.prepare("INSERT INTO inquiry_services VALUES (?,?)").bind("inq_staff","Photo"),
  ]);
});

describe("protected staff read API",()=>{
  it("rejects responder listing without authentication",async()=>expect((await exports.default.fetch(new Request("https://operations.example.test/v1/internal/responders"))).status).toBe(401));
  it("lists only internal active responders",async()=>{const response=await api("/v1/internal/responders");expect(response.status).toBe(200);const body=await response.json<{responders:Array<{id:string}>}>();expect(body.responders.map((item)=>item.id)).toEqual([responderA,responderB]);});
  it("lists active presence internally and supports explicit unavailable",async()=>{
    expect((await api("/v1/internal/presence/heartbeat",{method:"POST",body:JSON.stringify({responderId:responderA,available:true})})).status).toBe(200);
    let body=await (await api("/v1/internal/status")).json<{activeResponders:Array<{id:string}>}>();expect(body.activeResponders.map((item)=>item.id)).toContain(responderA);
    await api("/v1/internal/presence/heartbeat",{method:"POST",body:JSON.stringify({responderId:responderA,available:false})});
    body=await (await api("/v1/internal/status")).json();expect(body.activeResponders).toHaveLength(0);
  });
  it("returns bounded inbox search, assignment and workflow filters",async()=>{
    await api("/v1/internal/inquiries/inq_staff/assignment",{method:"PATCH",body:JSON.stringify({responderId:responderA,assigned:true,actorId:responderA})});
    const body=await (await api(`/v1/internal/inbox?query=Venue&workflow=new&assignment=${responderA}&limit=10`)).json<{inquiries:Array<{id:string;services:string}>;page:{total:number}}>();
    expect(body.inquiries).toHaveLength(1);expect(body.inquiries[0]).toMatchObject({id:"inq_staff",services:"Photo"});expect(body.page.total).toBe(1);
  });
  it("queries a schedule range and includes internal conflict assessment",async()=>{const body=await (await api("/v1/internal/schedule?start=2027-06-01&end=2027-06-30")).json<{events:Array<{id:string;assessment:{status:string}}>} >();expect(body.events[0]).toMatchObject({id:"evt_staff",assessment:{status:"clear"}});});
  it("rejects invalid schedule ranges",async()=>expect((await api("/v1/internal/schedule?start=bad&end=2027-06-30")).status).toBe(422));
});

describe("staff CRM mutations",()=>{
  it("assigns, changes workflow, adds an internal note and records audit history",async()=>{
    expect((await api("/v1/internal/inquiries/inq_staff/assignment",{method:"PATCH",body:JSON.stringify({responderId:responderA,assigned:true,actorId:responderA})})).status).toBe(200);
    expect((await api("/v1/internal/inquiries/inq_staff/workflow",{method:"PATCH",body:JSON.stringify({state:"reviewing",actorId:responderA})})).status).toBe(200);
    expect((await api("/v1/internal/inquiries/inq_staff/notes",{method:"POST",body:JSON.stringify({body:"Synthetic internal staff note",actorId:responderA})})).status).toBe(201);
    const detail=await (await api("/v1/internal/inquiries/inq_staff")).json<{assignments:unknown[];notes:Array<{author_label:string;body:string}>;activities:Array<{activity_type:string}>}>();
    expect(detail.assignments).toHaveLength(1);expect(detail.notes[0]).toMatchObject({author_label:"Test Responder A",body:"Synthetic internal staff note"});expect(detail.activities.map((item)=>item.activity_type)).toEqual(expect.arrayContaining(["responder_assigned","workflow_changed","internal_note_added"]));
  });
  it("rejects invalid inquiry IDs and unauthenticated mutations",async()=>{
    expect((await api("/v1/internal/inquiries/missing/workflow",{method:"PATCH",body:JSON.stringify({state:"reviewing",actorId:responderA})})).status).toBe(404);
    const response=await exports.default.fetch(new Request("https://operations.example.test/v1/internal/inquiries/inq_staff/workflow",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:"reviewing"})}));expect(response.status).toBe(401);
  });
});

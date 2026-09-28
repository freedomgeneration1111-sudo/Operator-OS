import { env,exports } from "cloudflare:workers";
import { beforeEach,describe,expect,it } from "vitest";
import { FOCUS_PRICING_KEYS } from "../src/cms-contracts";
import { stableStringify } from "../src/cms";

const token="development-test-token-00000000";
const manager="rsp_cms_manager";const responder="rsp_cms_responder";
const pricing={schemaVersion:1 as const,values:Object.fromEntries(FOCUS_PRICING_KEYS.map((key)=>[key,{amount:100,mode:"from",label:key}]))};
const faqs={schemaVersion:1 as const,common:[{id:"common_first",question:"First question?",answer:"First answer."}],pricing:[{id:"pricing_first",question:"Pricing question?",answer:"Pricing answer."}]};

function api(path:string,actor=manager,init:RequestInit={}){return exports.default.fetch(new Request(`https://operations.example.test${path}`,{...init,headers:{Authorization:`Bearer ${token}`,"X-Development-Responder-Id":actor,"Content-Type":"application/json",...init.headers}}));}
async function initialize(){return api("/v1/internal/cms/initialize",manager,{method:"POST",body:JSON.stringify({pricing,faqs})});}

beforeEach(async()=>{
  const now="2026-09-28T12:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO responders (id,display_label,active,created_at,updated_at) VALUES (?,?,?,?,?)").bind(manager,"CMS Manager",1,now,now),
    env.DB.prepare("INSERT INTO responders (id,display_label,active,created_at,updated_at) VALUES (?,?,?,?,?)").bind(responder,"CMS Responder",1,now,now),
  ]);
  await env.DB.prepare("UPDATE responders SET role='manager' WHERE id=?").bind(manager).run();
});

describe("Focus CMS authorization and isolation",()=>{
  it("rejects anonymous and responder access while granting the single manager capability",async()=>{
    expect((await exports.default.fetch(new Request("https://operations.example.test/v1/internal/cms"))).status).toBe(401);
    expect((await api("/v1/internal/cms",responder)).status).toBe(403);
    const me=await (await api("/v1/internal/me")).json<{user:{permissions:string[]}}>();
    expect(me.user.permissions).toContain("website:manage");
    expect((await api("/v1/internal/cms")).status).toBe(200);
  });
  it("fails closed for a business profile without the website module",async()=>{
    const prior=env.BUSINESS_PROFILE;env.BUSINESS_PROFILE="moses";
    try{const response=await api("/v1/internal/cms");expect(response.status).toBe(404);await expect(response.json()).resolves.toMatchObject({error:{code:"module_disabled"}});}
    finally{env.BUSINESS_PROFILE=prior;}
  });
});

describe("Focus CMS drafts",()=>{
  it("initializes from current content once without overwriting later edits",async()=>{
    expect((await initialize()).status).toBe(201);
    const state=await (await api("/v1/internal/cms")).json<{documents:{pricing:{revisionId:string;content:typeof pricing}}}>();
    const changed={...pricing,values:{...pricing.values,weddingDjCore:{amount:1700,mode:"from",label:"Edited label"}}};
    const saved=await api("/v1/internal/cms/documents/pricing",manager,{method:"PUT",body:JSON.stringify({expectedRevisionId:state.documents.pricing.revisionId,content:changed})});
    expect(saved.status).toBe(200);
    expect((await initialize()).status).toBe(200);
    const after=await (await api("/v1/internal/cms/documents/pricing")).json<{document:{content:typeof pricing}}>();
    expect(after.document.content.values.weddingDjCore.label).toBe("Edited label");
    expect(await env.CMS_DB.prepare("SELECT COUNT(*) count FROM cms_revisions WHERE document_key='pricing'").first<number>("count")).toBe(2);
  });
  it("validates stable pricing identifiers and FAQ input",async()=>{
    await initialize();const current=await (await api("/v1/internal/cms/documents/pricing")).json<{document:{revisionId:string}}>();
    const invalid={schemaVersion:1,values:{weddingDjCore:{amount:-1,mode:"broken",label:""}}};
    expect((await api("/v1/internal/cms/documents/pricing",manager,{method:"PUT",body:JSON.stringify({expectedRevisionId:current.document.revisionId,content:invalid})})).status).toBe(422);
  });
  it("detects concurrent stale edits",async()=>{
    await initialize();const current=await (await api("/v1/internal/cms/documents/pricing")).json<{document:{revisionId:string}}>();
    const edits=["Edit A","Edit B"].map((label)=>api("/v1/internal/cms/documents/pricing",manager,{method:"PUT",body:JSON.stringify({expectedRevisionId:current.document.revisionId,content:{...pricing,values:{...pricing.values,weddingDjCore:{amount:100,mode:"from",label}}}})}));
    const statuses=(await Promise.all(edits)).map((response)=>response.status).sort();expect(statuses).toEqual([200,409]);
  });
  it("restores an old revision as a new audited draft revision",async()=>{
    await initialize();const initial=await (await api("/v1/internal/cms/documents/faqs")).json<{document:{revisionId:string}}>();
    const updated={...faqs,common:[...faqs.common,{id:"common_second",question:"Second?",answer:"Second."}]};
    const saved=await (await api("/v1/internal/cms/documents/faqs",manager,{method:"PUT",body:JSON.stringify({expectedRevisionId:initial.document.revisionId,content:updated})})).json<{document:{revisionId:string;sequence:number}}>();
    const restored=await api("/v1/internal/cms/documents/faqs/restore",manager,{method:"POST",body:JSON.stringify({expectedRevisionId:saved.document.revisionId,revisionId:initial.document.revisionId})});
    expect(restored.status).toBe(200);const body=await restored.json<{document:{sequence:number;restoredFromRevisionId:string;content:typeof faqs}}>();
    expect(body.document).toMatchObject({sequence:3,restoredFromRevisionId:initial.document.revisionId});expect(body.document.content.common).toHaveLength(1);
    const history=await (await api("/v1/internal/cms/documents/faqs/revisions")).json<{revisions:Array<{actor:{id:string}}>} >();expect(history.revisions[0]?.actor.id).toBe(manager);
  });
  it("exports current revision identifiers and a verifiable immutable snapshot hash",async()=>{
    await initialize();const response=await api("/v1/internal/cms/snapshot");expect(response.status).toBe(200);
    const snapshot=await response.json<Record<string,unknown>&{integrity:{hash:string}}>();const {integrity,...core}=snapshot;
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(stableStringify(core)));const hex=Array.from(new Uint8Array(digest),(byte)=>byte.toString(16).padStart(2,"0")).join("");
    expect(integrity.hash).toBe(`sha256-${hex}`);expect(snapshot).toMatchObject({schemaVersion:1,business:"focus",documents:{pricing:{revisionId:expect.any(String)},faqs:{revisionId:expect.any(String)}}});
  });
});

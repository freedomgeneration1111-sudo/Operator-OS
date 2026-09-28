import { env,exports } from "cloudflare:workers";
import { beforeEach,describe,expect,it } from "vitest";
import { FOCUS_PRICING_KEYS } from "../src/cms-contracts";
import { handleCmsApi,stableStringify } from "../src/cms";

const token="development-test-token-00000000";
const manager="rsp_cms_manager";const responder="rsp_cms_responder";
const pricing={schemaVersion:1 as const,values:Object.fromEntries(FOCUS_PRICING_KEYS.map((key)=>[key,{amount:100,mode:"from",label:key}]))};
const faqs={schemaVersion:1 as const,common:[{id:"common_first",question:"First question?",answer:"First answer."}],pricing:[{id:"pricing_first",question:"Pricing question?",answer:"Pricing answer."}]};

function api(path:string,actor=manager,init:RequestInit={}){return exports.default.fetch(new Request(`https://operations.example.test${path}`,{...init,headers:{Authorization:`Bearer ${token}`,"X-Development-Responder-Id":actor,"Content-Type":"application/json",...init.headers}}));}
async function initialize(){return api("/v1/internal/cms/initialize",manager,{method:"POST",body:JSON.stringify({pricing,faqs})});}

function boundMember(target:object,property:PropertyKey){const value=Reflect.get(target,property,target) as unknown;return typeof value==="function"?value.bind(target):value;}
function wrapStatement(statement:D1PreparedStatement,intercept:boolean,beforeFirst:()=>Promise<void>):D1PreparedStatement{return new Proxy(statement,{get(target,property){if(property==="bind")return(...values:unknown[])=>wrapStatement(target.bind(...values),intercept,beforeFirst);if(property==="first"&&intercept)return async()=>{await beforeFirst();return target.first();};return boundMember(target,property);}});}

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
  it("reports enabled, disabled, missing-binding, and business-isolated CMS availability",async()=>{
    const originalProfile=env.BUSINESS_PROFILE;const originalEnabled=env.CMS_ENABLED;const originalDb=env.CMS_DB;
    try{
      await expect((await api("/v1/internal/status")).json()).resolves.toMatchObject({websiteManagement:{available:true,reason:"available"}});
      env.CMS_ENABLED="false";await expect((await api("/v1/internal/status")).json()).resolves.toMatchObject({websiteManagement:{available:false,reason:"configuration_disabled"}});
      env.CMS_ENABLED="true";env.CMS_DB=undefined;await expect((await api("/v1/internal/status")).json()).resolves.toMatchObject({websiteManagement:{available:false,reason:"binding_missing"}});
      env.CMS_DB=originalDb;env.BUSINESS_PROFILE="moses";await expect((await api("/v1/internal/status")).json()).resolves.toMatchObject({websiteManagement:{available:false,reason:"business_disabled"}});
      const responderSession=await (await api("/v1/internal/me",responder)).json<{user:{permissions:string[]}}>();expect(responderSession.user.permissions).not.toContain("website:manage");
    }finally{env.BUSINESS_PROFILE=originalProfile;env.CMS_ENABLED=originalEnabled;env.CMS_DB=originalDb;}
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
  it("returns the immutable revision saved by this request if the current pointer advances before the response read",async()=>{
    await initialize();
    const current=await (await api("/v1/internal/cms/documents/pricing")).json<{document:{revisionId:string}}>();
    const submitted={...pricing,values:{...pricing.values,weddingDjCore:{amount:1750,mode:"from",label:"Request-owned revision"}}};
    const later={...pricing,values:{...pricing.values,weddingDjCore:{amount:1800,mode:"from",label:"Later revision"}}};
    let advanced=false;
    const racingDb=new Proxy(env.CMS_DB,{
      get(target,property){
        if(property!=="prepare")return boundMember(target,property);
        return(query:string)=>wrapStatement(target.prepare(query),query.includes("FROM cms_revisions WHERE document_key=? AND revision_id=?"),async()=>{
          if(advanced)return;advanced=true;const now="2026-09-28T12:05:00.000Z";
          await target.batch([
            target.prepare(`INSERT INTO cms_revisions (revision_id,document_key,sequence,schema_version,content_json,actor_id,actor_display_name,created_at,restored_from_revision_id) VALUES (?,?,?,?,?,?,?,?,NULL)`).bind("pricing_later","pricing",3,1,JSON.stringify(later),manager,"CMS Manager",now),
            target.prepare("UPDATE cms_documents SET current_revision_id=?,current_sequence=3,updated_at=? WHERE document_key='pricing'").bind("pricing_later",now),
          ]);
        });
      },
    }) as D1Database;
    const request=new Request("https://operations.example.test/v1/internal/cms/documents/pricing",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedRevisionId:current.document.revisionId,content:submitted})});
    const response=await handleCmsApi(request,racingDb,"/v1/internal/cms/documents/pricing",{id:manager,displayName:"CMS Manager",role:"manager",verifiedEmail:null,accessSubject:null,authMode:"development"});
    const body=await response!.json<{document:{revisionId:string;content:typeof pricing}}>();
    expect(advanced).toBe(true);expect(body.document.revisionId).not.toBe("pricing_later");expect(body.document.content.values.weddingDjCore.label).toBe("Request-owned revision");
    const latest=await (await api("/v1/internal/cms/documents/pricing")).json<{document:{revisionId:string}}>();expect(latest.document.revisionId).toBe("pricing_later");
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

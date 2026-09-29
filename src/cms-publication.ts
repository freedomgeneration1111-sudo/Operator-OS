import { z } from "zod";
import { CMS_SCHEMA_VERSION,parseCmsDocument,type FaqDocument,type PricingDocument } from "./cms-contracts";
import { CmsError,initializeCmsFromRequest,stableStringify } from "./cms";
import type { StaffIdentity } from "./auth";

export type CmsReleaseStatus="queued"|"building"|"deploying"|"live"|"failed";
type ReleaseRow={release_id:string;request_id:string;operation_type:"publish"|"rollback";status:CmsReleaseStatus;schema_version:number;snapshot_json:string;integrity_hash:string;pricing_revision_id:string;faq_revision_id:string;actor_id:string;actor_display_name:string;requested_at:string;hook_triggered_at:string|null;runner_build_id:string|null;source_git_sha:string|null;runner_source_git_sha:string|null;worker_version_id:string|null;deployment_urls_json:string|null;deployment_target_json:string|null;started_at:string|null;completed_at:string|null;failure_code:string|null;failure_message:string|null;rollback_source_release_id:string|null;rollback_source_version_id:string|null};
type RevisionRow={revision_id:string;schema_version:number;content_json:string};
export type PublicationConfig={deployHookUrl?:string;runnerSecret?:string;hookFetch?:typeof fetch};
const MAX_PUBLICATION_BODY_BYTES=64_000;
const BOOTSTRAP_ACTOR={id:"system:cms-bootstrap",displayName:"CMS machine bootstrap"} as const;

const requestSchema=z.object({requestId:z.string().trim().min(8).max(160)}).strict();
const claimSchema=z.object({buildId:z.string().trim().min(1).max(200),runnerSourceGitSha:z.string().trim().min(7).max(100)}).strict();
const statusSchema=z.discriminatedUnion("status",[
  z.object({status:z.literal("deploying"),buildId:z.string().min(1).max(200),runnerSourceGitSha:z.string().min(7).max(100)}).strict(),
  z.object({status:z.literal("version_observed"),buildId:z.string().min(1).max(200),runnerSourceGitSha:z.string().min(7).max(100),workerVersionId:z.string().min(1).max(200),deploymentUrls:z.array(z.string().url().max(500)).max(20),deploymentTarget:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).optional()}).strict(),
  z.object({status:z.literal("failed"),buildId:z.string().min(1).max(200),runnerSourceGitSha:z.string().min(7).max(100),failureCode:z.string().min(1).max(100),failureMessage:z.string().min(1).max(1000)}).strict(),
  z.object({status:z.literal("live"),buildId:z.string().min(1).max(200),runnerSourceGitSha:z.string().min(7).max(100),workerVersionId:z.string().min(1).max(200),deploymentUrls:z.array(z.string().url().max(500)).max(20),deploymentTarget:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).optional()}).strict(),
]);

export async function publicationState(db:D1Database,configured:boolean){
  const [active,live,history]=await Promise.all([
    db.prepare("SELECT * FROM cms_releases WHERE active_slot=1 LIMIT 1").first<ReleaseRow>(),
    db.prepare("SELECT r.* FROM cms_publication_state s LEFT JOIN cms_releases r ON r.release_id=s.current_live_release_id WHERE s.singleton=1").first<ReleaseRow>(),
    db.prepare("SELECT * FROM cms_releases ORDER BY requested_at DESC LIMIT 50").all<ReleaseRow>(),
  ]);
  return{configured,active:active?presentRelease(active):null,live:live?.release_id?presentRelease(live):null,releases:history.results.map((row)=>presentRelease(row))};
}

export async function handleCmsPublicationApi(request:Request,db:D1Database,path:string,actor:StaffIdentity,config:PublicationConfig):Promise<Response|null>{
  if(path==="/v1/internal/cms/releases/publish"&&request.method==="POST"){
    ensureConfigured(config);const input=parseRequest(requestSchema,await readJson(request));const created=await createPublishRelease(db,input.requestId,actor);return created.created?trigger(db,created.release,config):json({ok:true,release:presentRelease(created.release)},202);
  }
  const rollback=path.match(/^\/v1\/internal\/cms\/releases\/([^/]+)\/rollback$/);
  if(rollback&&request.method==="POST"){
    ensureConfigured(config);const input=parseRequest(requestSchema,await readJson(request));const created=await createRollbackRelease(db,input.requestId,decodeURIComponent(rollback[1]!),actor);return created.created?trigger(db,created.release,config):json({ok:true,release:presentRelease(created.release)},202);
  }
  return null;
}

export async function handleCmsRunnerApi(request:Request,env:Pick<Env,"CMS_ENABLED"|"CMS_DB"|"CMS_RUNNER_SECRET"|"BUSINESS_PROFILE">,path:string):Promise<Response|null>{
  if(!path.startsWith("/v1/cms-runner/"))return null;
  if(env.BUSINESS_PROFILE!=="focus"||env.CMS_ENABLED!=="true"||!env.CMS_DB)throw new CmsError(404,"module_disabled","CMS publication is not enabled for this deployment");
  await authenticateMachine(request,env.CMS_RUNNER_SECRET);
  if(path==="/v1/cms-runner/initialize"&&request.method==="POST")return initializeCmsFromRequest(request,env.CMS_DB,BOOTSTRAP_ACTOR);
  if(path==="/v1/cms-runner/releases/active"&&request.method==="GET")return activeRelease(env.CMS_DB);
  if(path==="/v1/cms-runner/releases/claim"&&request.method==="POST"){
    const parsed=claimSchema.safeParse(await readJson(request));if(!parsed.success)throw validation(parsed.error);
    return claimRelease(env.CMS_DB,parsed.data.buildId,parsed.data.runnerSourceGitSha);
  }
  const status=path.match(/^\/v1\/cms-runner\/releases\/([^/]+)\/status$/);
  if(status&&request.method==="POST"){
    const parsed=statusSchema.safeParse(await readJson(request));if(!parsed.success)throw validation(parsed.error);
    return reportStatus(env.CMS_DB,decodeURIComponent(status[1]!),parsed.data);
  }
  return null;
}

async function createPublishRelease(db:D1Database,requestId:string,actor:StaffIdentity){
  const duplicate=await byRequest(db,requestId);if(duplicate)return{release:duplicate,created:false};
  const [pricing,faqs]=await Promise.all([currentRevision(db,"pricing"),currentRevision(db,"faqs")]);
  if(!pricing||!faqs)throw new CmsError(409,"cms_not_initialized","Pricing and FAQ drafts must both be initialized before publishing");
  const requestedAt=new Date().toISOString();const snapshot=await snapshotFor(pricing,faqs,requestedAt);const releaseId=`release_${crypto.randomUUID()}`;
  const result=await db.prepare(`INSERT OR IGNORE INTO cms_releases (release_id,request_id,operation_type,status,active_slot,schema_version,snapshot_json,integrity_hash,pricing_revision_id,faq_revision_id,actor_id,actor_display_name,requested_at)
    SELECT ?,?,'publish','queued',1,?,?,?,?,?,?,?,?
    WHERE EXISTS (SELECT 1 FROM cms_documents WHERE document_key='pricing' AND current_revision_id=?)
      AND EXISTS (SELECT 1 FROM cms_documents WHERE document_key='faqs' AND current_revision_id=?)
      AND NOT EXISTS (SELECT 1 FROM cms_releases WHERE active_slot=1)`)
    .bind(releaseId,requestId,CMS_SCHEMA_VERSION,JSON.stringify(snapshot),snapshot.integrity.hash,pricing.revision_id,faqs.revision_id,actor.id,actor.displayName,requestedAt,pricing.revision_id,faqs.revision_id).run();
  if(Number(result.meta.changes)!==1)return{release:await explainInsertFailure(db,requestId),created:false};
  return{release:await requiredRelease(db,releaseId),created:true};
}

async function createRollbackRelease(db:D1Database,requestId:string,sourceId:string,actor:StaffIdentity){
  const duplicate=await byRequest(db,requestId);if(duplicate)return{release:duplicate,created:false};
  const source=await requiredRelease(db,sourceId);const liveId=await db.prepare("SELECT current_live_release_id FROM cms_publication_state WHERE singleton=1").first<string>("current_live_release_id");
  if(source.status!=="live"||!source.worker_version_id)throw new CmsError(409,"rollback_unavailable","That release has no verified Worker version available for rollback");
  if(liveId===source.release_id)throw new CmsError(409,"already_live","That release is already the current live release");
  const releaseId=`release_${crypto.randomUUID()}`;const requestedAt=new Date().toISOString();
  const result=await db.prepare(`INSERT OR IGNORE INTO cms_releases (release_id,request_id,operation_type,status,active_slot,schema_version,snapshot_json,integrity_hash,pricing_revision_id,faq_revision_id,actor_id,actor_display_name,requested_at,source_git_sha,rollback_source_release_id,rollback_source_version_id)
    SELECT ?,?,'rollback','queued',1,schema_version,snapshot_json,integrity_hash,pricing_revision_id,faq_revision_id,?,?,?,source_git_sha,release_id,worker_version_id
    FROM cms_releases WHERE release_id=? AND status='live' AND worker_version_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cms_releases WHERE active_slot=1)`)
    .bind(releaseId,requestId,actor.id,actor.displayName,requestedAt,sourceId).run();
  if(Number(result.meta.changes)!==1)return{release:await explainInsertFailure(db,requestId),created:false};
  return{release:await requiredRelease(db,releaseId),created:true};
}

async function trigger(db:D1Database,release:ReleaseRow,config:PublicationConfig){
  if(release.status!=="queued")return json({ok:true,release:presentRelease(release)},202);
  try{
    const hookResponse=await (config.hookFetch??fetch)(config.deployHookUrl!,{method:"POST"});
    if(!hookResponse.ok)throw new Error(`Deploy hook returned HTTP ${hookResponse.status}`);
    const value=await hookResponse.json().catch(()=>null) as {result?:{build_uuid?:unknown}}|null;const buildId=value?.result?.build_uuid;
    if(typeof buildId!=="string"||!buildId.trim()||buildId.length>200)throw new Error("Deploy hook response did not include a valid build UUID");
    const now=new Date().toISOString();await db.prepare("UPDATE cms_releases SET runner_build_id=?,hook_triggered_at=? WHERE release_id=? AND status='queued' AND runner_build_id IS NULL").bind(buildId,now,release.release_id).run();
  }catch(error){await failRelease(db,release.release_id,"deploy_hook_failed",safeMessage(error));}
  return json({ok:true,release:presentRelease(await requiredRelease(db,release.release_id))},202);
}

async function claimRelease(db:D1Database,buildId:string,runnerSourceGitSha:string){
  const existing=await db.prepare("SELECT * FROM cms_releases WHERE runner_build_id=? LIMIT 1").bind(buildId).first<ReleaseRow>();
  if(!existing)throw new CmsError(409,"release_not_claimable","No queued release is assigned to this build identifier");
  if(existing.status==="queued"){
    const now=new Date().toISOString();const changed=await db.prepare("UPDATE cms_releases SET status='building',started_at=?,runner_source_git_sha=?,source_git_sha=CASE WHEN operation_type='publish' THEN ? ELSE source_git_sha END WHERE release_id=? AND status='queued' AND runner_build_id=?").bind(now,runnerSourceGitSha,runnerSourceGitSha,existing.release_id,buildId).run();
    if(Number(changed.meta.changes)!==1)throw new CmsError(409,"release_claim_conflict","The release was claimed by another runner");
  }else if(existing.status!=="building"&&existing.status!=="deploying")throw new CmsError(409,"release_not_claimable","This build identifier has no claimable release");
  else if(existing.runner_source_git_sha!==runnerSourceGitSha)throw new CmsError(409,"runner_source_mismatch","This build identifier is already assigned to a different runner source");
  const release=await requiredRelease(db,existing.release_id);return json({ok:true,release:{...presentRelease(release),snapshot:JSON.parse(release.snapshot_json) as unknown}},200);
}

async function reportStatus(db:D1Database,releaseId:string,input:z.infer<typeof statusSchema>){
  const current=await requiredRelease(db,releaseId);
  if(current.runner_build_id!==input.buildId)throw new CmsError(409,"runner_build_mismatch","This runner is not assigned to the release");
  if(current.runner_source_git_sha!==input.runnerSourceGitSha)throw new CmsError(409,"runner_source_mismatch","This runner source is not assigned to the release");
  if(input.status==="version_observed"){
    if(current.status!=="deploying")throw transition(current.status,input.status);
    if(current.worker_version_id&&current.worker_version_id!==input.workerVersionId)throw new CmsError(409,"stale_callback","A different Worker version is already associated with this release");
    if(!current.worker_version_id){
      const changed=await db.prepare("UPDATE cms_releases SET worker_version_id=?,deployment_urls_json=?,deployment_target_json=? WHERE release_id=? AND status='deploying' AND runner_build_id=? AND worker_version_id IS NULL")
        .bind(input.workerVersionId,JSON.stringify(input.deploymentUrls),JSON.stringify(input.deploymentTarget??{}),releaseId,input.buildId).run();
      if(Number(changed.meta.changes)!==1)throw new CmsError(409,"stale_callback","The release state changed before the observed Worker version was recorded");
    }
    return json({ok:true,release:presentRelease(await requiredRelease(db,releaseId))});
  }
  if(current.status===input.status){
    if(input.status==="live"&&current.worker_version_id!==input.workerVersionId)throw new CmsError(409,"stale_callback","The release already completed with different deployment metadata");
    return json({ok:true,release:presentRelease(current)});
  }
  if(input.status==="deploying"){
    if(current.status!=="building")throw transition(current.status,input.status);
    await db.prepare("UPDATE cms_releases SET status='deploying' WHERE release_id=? AND status='building' AND runner_build_id=?").bind(releaseId,input.buildId).run();
  }else if(input.status==="failed"){
    if(!["building","deploying"].includes(current.status))throw transition(current.status,input.status);
    if(current.worker_version_id)throw new CmsError(409,"ambiguous_deployment","A Worker version is already associated with this release; reconcile it instead of marking it failed");
    await failRelease(db,releaseId,input.failureCode,input.failureMessage,input.buildId,input.runnerSourceGitSha);
  }else{
    if(current.status!=="deploying")throw transition(current.status,input.status);
    if(current.worker_version_id!==input.workerVersionId)throw new CmsError(409,"stale_callback","The verified Worker version does not match the version associated with this release");
    const completedAt=new Date().toISOString();const urls=JSON.stringify(input.deploymentUrls);const target=JSON.stringify(input.deploymentTarget??{});
    const [updated]=await db.batch([
      db.prepare("UPDATE cms_releases SET status='live',active_slot=NULL,deployment_urls_json=?,deployment_target_json=?,completed_at=?,failure_code=NULL,failure_message=NULL WHERE release_id=? AND status='deploying' AND runner_build_id=? AND worker_version_id=?")
        .bind(urls,target,completedAt,releaseId,input.buildId,input.workerVersionId),
      db.prepare(`UPDATE cms_publication_state SET current_live_release_id=?,updated_at=? WHERE singleton=1
        AND EXISTS (SELECT 1 FROM cms_releases WHERE release_id=? AND status='live' AND runner_build_id=? AND completed_at=?)`)
        .bind(releaseId,completedAt,releaseId,input.buildId,completedAt),
    ]);
    if(Number(updated?.meta.changes)!==1)throw new CmsError(409,"stale_callback","The release state changed before deployment completion was recorded");
  }
  return json({ok:true,release:presentRelease(await requiredRelease(db,releaseId))});
}

async function activeRelease(db:D1Database){const release=await db.prepare("SELECT * FROM cms_releases WHERE active_slot=1 LIMIT 1").first<ReleaseRow>();return json({ok:true,release:release?presentRelease(release):null});}

async function failRelease(db:D1Database,releaseId:string,code:string,message:string,buildId?:string,runnerSourceGitSha?:string){
  const condition=buildId?" AND runner_build_id=?":"";const binds:unknown[]=[code.slice(0,100),message.slice(0,1000),runnerSourceGitSha??null,new Date().toISOString(),releaseId];if(buildId)binds.push(buildId);
  await db.prepare(`UPDATE cms_releases SET status='failed',active_slot=NULL,failure_code=?,failure_message=?,runner_source_git_sha=COALESCE(?,runner_source_git_sha),completed_at=? WHERE release_id=? AND status IN ('queued','building','deploying')${condition}`).bind(...binds).run();
}

async function currentRevision(db:D1Database,key:"pricing"|"faqs"){return db.prepare(`SELECT r.revision_id,r.schema_version,r.content_json FROM cms_documents d JOIN cms_revisions r ON r.revision_id=d.current_revision_id WHERE d.document_key=?`).bind(key).first<RevisionRow>();}
async function snapshotFor(pricing:RevisionRow,faqs:RevisionRow,exportedAt:string){
  const core={schemaVersion:CMS_SCHEMA_VERSION,business:"focus" as const,exportedAt,documents:{pricing:{revisionId:pricing.revision_id,schemaVersion:Number(pricing.schema_version),content:parseCmsDocument("pricing",JSON.parse(pricing.content_json)) as PricingDocument},faqs:{revisionId:faqs.revision_id,schemaVersion:Number(faqs.schema_version),content:parseCmsDocument("faqs",JSON.parse(faqs.content_json)) as FaqDocument}}};
  return{...core,integrity:{algorithm:"SHA-256" as const,hash:`sha256-${await sha256(stableStringify(core))}`}};
}
async function explainInsertFailure(db:D1Database,requestId:string):Promise<ReleaseRow>{const duplicate=await byRequest(db,requestId);if(duplicate)return duplicate;const active=await db.prepare("SELECT release_id FROM cms_releases WHERE active_slot=1").first<string>("release_id");if(active)throw new CmsError(409,"publication_in_progress","Another publish or rollback operation is already in progress",{releaseId:[active]});throw new CmsError(409,"draft_changed","Saved drafts changed while the release was being captured; review them and publish again");}
async function byRequest(db:D1Database,requestId:string){return db.prepare("SELECT * FROM cms_releases WHERE request_id=?").bind(requestId).first<ReleaseRow>();}
async function requiredRelease(db:D1Database,releaseId:string){const row=await db.prepare("SELECT * FROM cms_releases WHERE release_id=?").bind(releaseId).first<ReleaseRow>();if(!row)throw new CmsError(404,"release_not_found","The requested release does not exist");return row;}
function presentRelease(row:ReleaseRow){return{releaseId:row.release_id,requestId:row.request_id,operationType:row.operation_type,status:row.status,schemaVersion:Number(row.schema_version),integrityHash:row.integrity_hash,pricingRevisionId:row.pricing_revision_id,faqRevisionId:row.faq_revision_id,actor:{id:row.actor_id,displayName:row.actor_display_name},requestedAt:row.requested_at,hookTriggeredAt:row.hook_triggered_at,runnerBuildId:row.runner_build_id,sourceGitSha:row.source_git_sha,runnerSourceGitSha:row.runner_source_git_sha,workerVersionId:row.worker_version_id,deploymentUrls:parseArray(row.deployment_urls_json),deploymentTarget:parseObject(row.deployment_target_json),startedAt:row.started_at,completedAt:row.completed_at,failure:row.failure_code?{code:row.failure_code,message:row.failure_message}:null,rollbackSourceReleaseId:row.rollback_source_release_id,rollbackSourceVersionId:row.rollback_source_version_id};}
function parseArray(value:string|null){if(!value)return[];try{const parsed=JSON.parse(value) as unknown;return Array.isArray(parsed)?parsed:[];}catch{return[];}}
function parseObject(value:string|null){if(!value)return null;try{const parsed=JSON.parse(value) as unknown;return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:null;}catch{return null;}}
function ensureConfigured(config:PublicationConfig){if(!config.deployHookUrl||!config.runnerSecret)throw new CmsError(503,"publication_not_configured","Website publication is not configured for this deployment");}
async function authenticateMachine(request:Request,secret:string|undefined){if(!secret)throw new CmsError(503,"publication_not_configured","The CMS build runner is not configured");const header=request.headers.get("Authorization");const supplied=header?.startsWith("Bearer ")?header.slice(7):"";const [left,right]=await Promise.all([digestBytes(supplied),digestBytes(secret)]);const subtle=crypto.subtle as SubtleCrypto&{timingSafeEqual(left:ArrayBufferView,right:ArrayBufferView):boolean};if(!subtle.timingSafeEqual(left,right))throw new CmsError(401,"machine_authentication_required","Valid CMS runner credentials are required");}
async function digestBytes(value:string){return new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));}
async function sha256(value:string){const bytes=await digestBytes(value);return Array.from(bytes,(byte)=>byte.toString(16).padStart(2,"0")).join("");}
async function readJson(request:Request){const length=Number(request.headers.get("Content-Length")??0);if(length>MAX_PUBLICATION_BODY_BYTES)throw new CmsError(413,"payload_too_large","Publication request body is too large");const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_PUBLICATION_BODY_BYTES)throw new CmsError(413,"payload_too_large","Publication request body is too large");try{return JSON.parse(text) as unknown;}catch{throw new CmsError(400,"invalid_json","Request body must be valid JSON");}}
function validation(error:z.ZodError){return new CmsError(422,"validation_error","Publication request validation failed",error.flatten().fieldErrors as Record<string,string[]>);}
function parseRequest<T>(schema:z.ZodType<T>,value:unknown){const parsed=schema.safeParse(value);if(!parsed.success)throw validation(parsed.error);return parsed.data;}
function transition(from:string,to:string){return new CmsError(409,"invalid_release_transition",`Release cannot move from ${from} to ${to}`);}
function safeMessage(error:unknown){return error instanceof Error?error.message:"Publication orchestration failed";}
function json(data:object,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});}

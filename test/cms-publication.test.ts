import { env } from "cloudflare:workers";
import { beforeEach,describe,expect,it } from "vitest";
import { FOCUS_PRICING_KEYS } from "../src/cms-contracts";
import { handleCmsApi } from "../src/cms";
import { handleCmsRunnerApi } from "../src/cms-publication";
import type { StaffIdentity } from "../src/auth";

const actor:StaffIdentity={id:"cms_manager",displayName:"CMS Manager",role:"manager",verifiedEmail:null,accessSubject:null,authMode:"development"};
const runnerSecret="test-cms-runner-secret-00000000";
const pricing={schemaVersion:1 as const,values:Object.fromEntries(FOCUS_PRICING_KEYS.map((key)=>[key,{amount:100,mode:"from",label:key}]))};
const faqs={schemaVersion:1 as const,common:[{id:"common_first",question:"First?",answer:"First."}],pricing:[{id:"pricing_first",question:"Price?",answer:"Price."}]};
let hookSequence=0;
const config=()=>({deployHookUrl:"https://deploy.example.test/hook",runnerSecret,hookFetch:async()=>Response.json({result:{build_uuid:`build-${++hookSequence}`}})});

beforeEach(()=>{hookSequence=0;});

async function cms(path:string,body?:unknown,publication=config()){
  const response=await handleCmsApi(new Request(`https://api.example.test${path}`,body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),env.CMS_DB,path,actor,publication);
  if(!response)throw new Error(`No CMS route for ${path}`);return response;
}
async function initialize(){await cms("/v1/internal/cms/initialize",{pricing,faqs},{});}
async function publish(requestId="publish-request-0001"){const response=await cms("/v1/internal/cms/releases/publish",{requestId});return response.json<{release:Release}>();}
async function runner(path:string,body:unknown,secret=runnerSecret){const request=new Request(`https://api.example.test${path}`,{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const response=await handleCmsRunnerApi(request,{BUSINESS_PROFILE:"focus",CMS_ENABLED:"true",CMS_DB:env.CMS_DB,CMS_RUNNER_SECRET:runnerSecret},path);if(!response)throw new Error(`No runner route for ${path}`);return response;}
async function claim(buildId:string,sha="abcdef1234567890"){return (await runner("/v1/cms-runner/releases/claim",{buildId,runnerSourceGitSha:sha})).json<{release:Release&{snapshot:Snapshot}}>();}
async function report(releaseId:string,input:Record<string,unknown>){return runner(`/v1/cms-runner/releases/${releaseId}/status`,input);}
async function makeLive(requestId:string,version:string,runnerSha="abcdef1234567890"){const {release}=await publish(requestId);await claim(release.runnerBuildId!,runnerSha);await report(release.releaseId,{status:"deploying",buildId:release.runnerBuildId,runnerSourceGitSha:runnerSha});const response=await report(release.releaseId,{status:"live",buildId:release.runnerBuildId,runnerSourceGitSha:runnerSha,workerVersionId:version,deploymentUrls:["https://focuslabproductions.com"],deploymentTarget:{worker:"focus-lab-public-staging"}});return (await response.json<{release:Release}>()).release;}

type Release={releaseId:string;requestId:string;operationType:"publish"|"rollback";status:string;pricingRevisionId:string;faqRevisionId:string;runnerBuildId:string|null;sourceGitSha:string|null;runnerSourceGitSha:string|null;workerVersionId:string|null;rollbackSourceReleaseId:string|null;failure:{code:string;message:string}|null};
type Snapshot={documents:{pricing:{revisionId:string;content:typeof pricing};faqs:{revisionId:string;content:typeof faqs}};integrity:{hash:string}};

describe("immutable CMS publication",()=>{
  it("captures saved revisions immutably and later draft edits do not change the claimed release",async()=>{
    await initialize();const {release}=await publish();const state=await (await cms("/v1/internal/cms")).json<{documents:{pricing:{revisionId:string}}}>();
    const changed={...pricing,values:{...pricing.values,weddingDjCore:{...pricing.values.weddingDjCore,label:"Later saved label"}}};
    await handleCmsApi(new Request("https://api.example.test/v1/internal/cms/documents/pricing",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedRevisionId:state.documents.pricing.revisionId,content:changed})}),env.CMS_DB,"/v1/internal/cms/documents/pricing",actor,{});
    const claimed=await claim(release.runnerBuildId!);expect(claimed.release.snapshot.documents.pricing.revisionId).toBe(release.pricingRevisionId);expect(claimed.release.snapshot.documents.pricing.content.values.weddingDjCore.label).toBe("weddingDjCore");
  });

  it("deduplicates retries and serializes different publication requests",async()=>{
    await initialize();const first=await publish("same-request-0001");const duplicate=await publish("same-request-0001");expect(duplicate.release.releaseId).toBe(first.release.releaseId);expect(hookSequence).toBe(1);
    await expect(publish("different-request-0002")).rejects.toMatchObject({status:409,code:"publication_in_progress"});
  });

  it("keeps a second publication blocked while a post-mutation operation remains deploying",async()=>{
    await initialize();const first=await publish("ambiguous-release-0001");await claim(first.release.runnerBuildId!);
    await report(first.release.releaseId,{status:"deploying",buildId:first.release.runnerBuildId,runnerSourceGitSha:"abcdef1234567890"});
    await expect(publish("blocked-release-0002")).rejects.toMatchObject({status:409,code:"publication_in_progress"});
    const state=await (await cms("/v1/internal/cms")).json<{publication:{active:Release}}>();expect(state.publication.active).toMatchObject({releaseId:first.release.releaseId,status:"deploying"});
  });

  it("rejects missing orchestration configuration and unauthenticated machine runners",async()=>{
    await initialize();await expect(cms("/v1/internal/cms/releases/publish",{requestId:"missing-config-0001"},{})).rejects.toMatchObject({status:503,code:"publication_not_configured"});
    await expect(cms("/v1/internal/cms/releases/publish",{requestId:"short"})).rejects.toMatchObject({status:422,code:"validation_error"});
    await expect(runner("/v1/cms-runner/releases/claim",{buildId:"wrong",runnerSourceGitSha:"abcdef1"},"wrong-secret")).rejects.toMatchObject({status:401,code:"machine_authentication_required"});
    expect(await env.CMS_DB.prepare("SELECT COUNT(*) count FROM cms_releases").first<number>("count")).toBe(0);
  });

  it("requires the exact hook build identifier and stores exact successful deployment metadata",async()=>{
    await initialize();const {release}=await publish();await expect(claim("build-other")).rejects.toMatchObject({status:409,code:"release_not_claimable"});await claim(release.runnerBuildId!,"1234567890abcdef");
    await expect(claim(release.runnerBuildId!,"different1234567")).rejects.toMatchObject({status:409,code:"runner_source_mismatch"});
    await report(release.releaseId,{status:"deploying",buildId:release.runnerBuildId,runnerSourceGitSha:"1234567890abcdef"});
    const liveInput={status:"live",buildId:release.runnerBuildId,runnerSourceGitSha:"1234567890abcdef",workerVersionId:"worker-version-exact",deploymentUrls:["https://focuslabproductions.com"],deploymentTarget:{worker:"focus-lab-public-staging"}};
    const live=await (await report(release.releaseId,liveInput)).json<{release:Release}>();expect(live.release).toMatchObject({status:"live",workerVersionId:"worker-version-exact"});
    expect((await report(release.releaseId,liveInput)).status).toBe(200);
    await expect(report(release.releaseId,{...liveInput,workerVersionId:"stale-version"})).rejects.toMatchObject({status:409,code:"stale_callback"});
  });

  it("leaves the prior live release unchanged after build or deployment failure",async()=>{
    await initialize();const original=await makeLive("original-live-0001","version-original");
    const buildFailure=await publish("build-failure-0002");await claim(buildFailure.release.runnerBuildId!);await report(buildFailure.release.releaseId,{status:"failed",buildId:buildFailure.release.runnerBuildId,runnerSourceGitSha:"abcdef1234567890",failureCode:"build_failed",failureMessage:"Static build failed"});
    let state=await (await cms("/v1/internal/cms")).json<{publication:{live:Release}}>();// live pointer must not move
    expect(state.publication.live.releaseId).toBe(original.releaseId);
    const deployFailure=await publish("deploy-failure-0003");await claim(deployFailure.release.runnerBuildId!);await report(deployFailure.release.releaseId,{status:"deploying",buildId:deployFailure.release.runnerBuildId,runnerSourceGitSha:"abcdef1234567890"});await report(deployFailure.release.releaseId,{status:"failed",buildId:deployFailure.release.runnerBuildId,runnerSourceGitSha:"abcdef1234567890",failureCode:"deploy_failed",failureMessage:"Wrangler failed"});
    state=await (await cms("/v1/internal/cms")).json<{publication:{live:Release}}> ();expect(state.publication.live.releaseId).toBe(original.releaseId);
  });

  it("records a mocked deploy-hook failure without moving the live pointer",async()=>{
    await initialize();const original=await makeLive("hook-original-0001","hook-version-original");const response=await cms("/v1/internal/cms/releases/publish",{requestId:"hook-failure-0002"},{deployHookUrl:"https://deploy.example.test/hook",runnerSecret,hookFetch:async()=>new Response("no",{status:503})});const failed=(await response.json<{release:Release}>()).release;expect(failed).toMatchObject({status:"failed",failure:{code:"deploy_hook_failed"}});const state=await (await cms("/v1/internal/cms")).json<{publication:{live:Release}}>();expect(state.publication.live.releaseId).toBe(original.releaseId);
  });

  it("rolls back only to a recorded version without altering the saved draft",async()=>{
    await initialize();const first=await makeLive("first-live-0001","version-first","historicalsha111111");const second=await makeLive("second-live-0002","version-second","newersourcesha22222");
    const before=await (await cms("/v1/internal/cms")).json<{documents:{pricing:{revisionId:string};faqs:{revisionId:string}}}>();
    const failedRollback=await cms(`/v1/internal/cms/releases/${first.releaseId}/rollback`,{requestId:"rollback-failure-0003"});const failedOperation=(await failedRollback.json<{release:Release}>()).release;await claim(failedOperation.runnerBuildId!,"fedcba9876543210");await report(failedOperation.releaseId,{status:"deploying",buildId:failedOperation.runnerBuildId,runnerSourceGitSha:"fedcba9876543210"});await report(failedOperation.releaseId,{status:"failed",buildId:failedOperation.runnerBuildId,runnerSourceGitSha:"fedcba9876543210",failureCode:"rollback_failed",failureMessage:"Cloudflare rejected rollback"});
    let after=await (await cms("/v1/internal/cms")).json<{documents:{pricing:{revisionId:string};faqs:{revisionId:string}};publication:{live:Release}}>();expect(after.documents).toEqual(before.documents);expect(after.publication.live.releaseId).toBe(second.releaseId);
    const rollback=await cms(`/v1/internal/cms/releases/${first.releaseId}/rollback`,{requestId:"rollback-request-0004"});const operation=(await rollback.json<{release:Release}>()).release;
    expect(operation).toMatchObject({operationType:"rollback",rollbackSourceReleaseId:first.releaseId,sourceGitSha:"historicalsha111111",runnerSourceGitSha:null});expect(operation.workerVersionId).toBeNull();
    const claimed=await claim(operation.runnerBuildId!,"fedcba9876543210");expect(claimed.release).toMatchObject({sourceGitSha:"historicalsha111111",runnerSourceGitSha:"fedcba9876543210"});
    await report(operation.releaseId,{status:"deploying",buildId:operation.runnerBuildId,runnerSourceGitSha:"fedcba9876543210"});await report(operation.releaseId,{status:"live",buildId:operation.runnerBuildId,runnerSourceGitSha:"fedcba9876543210",workerVersionId:"version-first",deploymentUrls:["https://focuslabproductions.com"],deploymentTarget:{rollback:true}});
    after=await (await cms("/v1/internal/cms")).json<{documents:{pricing:{revisionId:string};faqs:{revisionId:string}};publication:{live:Release}}>();expect(after.documents).toEqual(before.documents);expect(after.publication.live.releaseId).toBe(operation.releaseId);
    expect(after.publication.live).toMatchObject({sourceGitSha:"historicalsha111111",runnerSourceGitSha:"fedcba9876543210"});
  });

  it("does not substitute the current runner SHA when historical rollback source provenance is unknown",async()=>{
    await initialize();const first=await makeLive("unknown-source-first-0001","version-first");await makeLive("unknown-source-second-0002","version-second");
    await env.CMS_DB.prepare("UPDATE cms_releases SET source_git_sha=NULL WHERE release_id=?").bind(first.releaseId).run();
    const response=await cms(`/v1/internal/cms/releases/${first.releaseId}/rollback`,{requestId:"unknown-source-rollback-0003"});const operation=(await response.json<{release:Release}>()).release;
    expect(operation.sourceGitSha).toBeNull();const claimed=await claim(operation.runnerBuildId!,"currentrunner333333");
    expect(claimed.release).toMatchObject({sourceGitSha:null,runnerSourceGitSha:"currentrunner333333"});
  });
});

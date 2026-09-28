import { expect,test,type Page,type Route } from "@playwright/test";

const manager={id:"cms_manager",display_label:"CMS Manager",role:"manager" as const,active:1,currently_available:0,heartbeat_at:null,expires_at:null};
const responder={...manager,id:"cms_responder",display_label:"CMS Responder",role:"responder" as const};
const pricing={schemaVersion:1 as const,values:{weddingDjCore:{amount:1700,mode:"from" as const,label:"Wedding DJ/MC"}}};
const olderPricing={schemaVersion:1 as const,values:{weddingDjCore:{amount:1600,mode:"from" as const,label:"Earlier DJ label"}}};
const faqs={schemaVersion:1 as const,common:[{id:"common_one",question:"Can I book one service?",answer:"Yes."}],pricing:[{id:"pricing_one",question:"Is this final?",answer:"It is a starting point."}]};
const olderFaqs={...faqs,common:[{...faqs.common[0]!,answer:"Earlier answer."}]};
type Options={availability?:{available:boolean;reason:"available"|"business_disabled"|"configuration_disabled"|"binding_missing"};initialized?:boolean;delayPricingSave?:boolean;conflictPricingOnce?:boolean;actor?:typeof manager|typeof responder};
type PricingRevision=ReturnType<typeof pricingRevision>;type FaqRevision=ReturnType<typeof faqRevision>;
const pricingRevision=(sequence:number,content=pricing)=>({revisionId:`pricing_${sequence}`,documentKey:"pricing" as const,sequence,schemaVersion:1,content,actor:{id:manager.id,displayName:manager.display_label},createdAt:`2026-09-28T12:0${sequence}:00.000Z`,restoredFromRevisionId:null as string|null});
const faqRevision=(sequence:number,content=faqs)=>({revisionId:`faqs_${sequence}`,documentKey:"faqs" as const,sequence,schemaVersion:1,content,actor:{id:manager.id,displayName:manager.display_label},createdAt:`2026-09-28T12:0${sequence}:00.000Z`,restoredFromRevisionId:null as string|null});

async function mock(page:Page,options:Options={}){
  let pricingCurrent:PricingRevision=pricingRevision(1);let faqCurrent:FaqRevision=faqRevision(1);let conflicted=false;let restoreCalls=0;const pricingExpectedRevisions:string[]=[];const faqExpectedRevisions:string[]=[];
  const pricingHistory:PricingRevision[]=[pricingCurrent,{...pricingRevision(0,olderPricing),revisionId:"pricing_older",createdAt:"2026-09-27T12:00:00.000Z"}];
  const faqHistory:FaqRevision[]=[faqCurrent,{...faqRevision(0,olderFaqs),revisionId:"faqs_older",createdAt:"2026-09-27T12:00:00.000Z"}];
  const actor=options.actor??manager;const availability=options.availability??{available:true as const,reason:"available" as const};
  await page.route("http://127.0.0.1:8787/**",async(route:Route)=>{
    const request=route.request();const path=new URL(request.url()).pathname;
    if(path==="/v1/internal/responders")return json(route,{ok:true,responders:[actor]});
    if(path==="/v1/internal/status")return json(route,{ok:true,chat:{state:"async",label:"Message",destinationUrl:null},activeResponders:[],messaging:{configured:false,provider:null},presenceTimeoutSeconds:120,eventCapacity:1,websiteManagement:availability});
    if(path==="/v1/internal/cms")return json(route,{ok:true,initialized:options.initialized!==false,documents:options.initialized===false?{pricing:null,faqs:null}:{pricing:pricingCurrent,faqs:faqCurrent}});
    if(path.endsWith("/revisions")){const isPricing=path.includes("pricing");return json(route,{ok:true,documentKey:isPricing?"pricing":"faqs",revisions:isPricing?pricingHistory:faqHistory});}
    if(path.endsWith("/restore")){restoreCalls+=1;const body=request.postDataJSON() as {revisionId:string};if(path.includes("pricing")){pricingCurrent={...pricingRevision(pricingCurrent.sequence+1,body.revisionId==="pricing_older"?olderPricing:pricingCurrent.content),restoredFromRevisionId:body.revisionId};pricingHistory.unshift(pricingCurrent);return json(route,{ok:true,document:pricingCurrent});}faqCurrent={...faqRevision(faqCurrent.sequence+1,body.revisionId==="faqs_older"?olderFaqs:faqCurrent.content),restoredFromRevisionId:body.revisionId};faqHistory.unshift(faqCurrent);return json(route,{ok:true,document:faqCurrent});}
    if(path==="/v1/internal/cms/documents/pricing"&&request.method()==="GET")return json(route,{ok:true,document:pricingCurrent});
    if(path==="/v1/internal/cms/documents/faqs"&&request.method()==="GET")return json(route,{ok:true,document:faqCurrent});
    if(path==="/v1/internal/cms/snapshot")return json(route,{schemaVersion:1});
    if(path==="/v1/internal/cms/documents/pricing"&&request.method()==="PUT"){
      const body=request.postDataJSON() as {expectedRevisionId:string;content:typeof pricing};pricingExpectedRevisions.push(body.expectedRevisionId);
      if(options.conflictPricingOnce&&!conflicted){conflicted=true;pricingCurrent=pricingRevision(2,{...pricing,values:{...pricing.values,weddingDjCore:{...pricing.values.weddingDjCore,label:"Server-owned edit"}}});pricingHistory.unshift(pricingCurrent);return json(route,{ok:false,error:{code:"cms_revision_conflict",message:"A newer pricing draft exists"}},409);}
      if(options.delayPricingSave)await new Promise((resolve)=>setTimeout(resolve,600));pricingCurrent=pricingRevision(pricingCurrent.sequence+1,body.content);pricingHistory.unshift(pricingCurrent);return json(route,{ok:true,document:pricingCurrent});
    }
    if(path==="/v1/internal/cms/documents/faqs"&&request.method()==="PUT"){const body=request.postDataJSON() as {expectedRevisionId:string;content:typeof faqs};faqExpectedRevisions.push(body.expectedRevisionId);faqCurrent=faqRevision(faqCurrent.sequence+1,body.content);faqHistory.unshift(faqCurrent);return json(route,{ok:true,document:faqCurrent});}
    return json(route,{ok:true});
  });
  return{pricingExpectedRevisions,faqExpectedRevisions,get restoreCalls(){return restoreCalls;}};
}
async function login(page:Page,actor=manager){await page.goto("/");await page.getByLabel("Development API token").fill("test-token");await page.getByRole("button",{name:"Connect to Local Operations"}).click();await page.getByLabel("Act as responder").selectOption(actor.id);await page.getByRole("button",{name:"Open Staff Workspace"}).click();}
async function openWebsite(page:Page){await page.getByRole("link",{name:"Website"}).first().click();await expect(page.getByRole("heading",{name:"Pricing & FAQs"})).toBeVisible();}

test("cross-document edits survive delayed saves and each document reports its own state",async({page})=>{
  const calls=await mock(page,{delayPricingSave:true});await login(page);await openWebsite(page);
  const price=page.getByLabel("Amount (USD)");const commonAnswer=page.getByLabel("Answer").first();await commonAnswer.fill("Unsaved FAQ edit");await price.fill("1800");
  await page.getByRole("button",{name:"Save draft"}).first().click();await expect(price).toBeDisabled();await expect(commonAnswer).toBeEnabled();await commonAnswer.fill("FAQ edit made while pricing saves");await expect(page.getByText("Saved as draft revision 2.")).toBeVisible();await expect(commonAnswer).toHaveValue("FAQ edit made while pricing saves");await expect(page.getByText("Unsaved changes.",{exact:true})).toBeVisible();
  await price.fill("1850");await page.getByRole("button",{name:"Save draft"}).last().click();await expect(page.getByText("Saved as draft revision 2.")).toHaveCount(1);await expect(price).toHaveValue("1850");await expect(page.getByText("Unsaved changes.",{exact:true})).toBeVisible();
  expect(calls.pricingExpectedRevisions).toEqual(["pricing_1"]);expect(calls.faqExpectedRevisions).toEqual(["faqs_1"]);await expect(page.getByText("Exports saved drafts only. Unsaved form changes are excluded.")).toBeVisible();
});

test("conflicts preserve input and require an explicit recovery choice",async({page})=>{
  const calls=await mock(page,{conflictPricingOnce:true});await login(page);await openWebsite(page);const label=page.getByLabel("Label").first();await label.fill("My unsaved label");await page.getByRole("button",{name:"Save draft"}).first().click();await expect(page.getByText(/newer saved draft exists/i)).toBeVisible();await expect(label).toHaveValue("My unsaved label");await expect(page.getByRole("button",{name:"Discard my edits and load latest"})).toBeVisible();await page.getByRole("button",{name:"Keep my edits on latest revision"}).click();await expect(label).toHaveValue("My unsaved label");await expect(page.getByText(/now use the latest saved revision as their base/i)).toBeVisible();await page.getByRole("button",{name:"Save draft"}).first().click();await expect(page.getByText("Saved as draft revision 3.")).toBeVisible();expect(calls.pricingExpectedRevisions).toEqual(["pricing_1","pricing_2"]);
});

test("history refresh and cancelled reload or restore never discard unsaved forms",async({page})=>{
  const calls=await mock(page);await login(page);await openWebsite(page);const label=page.getByLabel("Label").first();const commonAnswer=page.getByLabel("Answer").first();await label.fill("Unsaved price label");await commonAnswer.fill("Unsaved FAQ answer");await page.getByRole("button",{name:"Refresh history"}).click();await expect(label).toHaveValue("Unsaved price label");await expect(commonAnswer).toHaveValue("Unsaved FAQ answer");
  const restorable=page.locator("button:not(:disabled)",{hasText:"Restore as new draft"}).first();page.once("dialog",(dialog)=>dialog.dismiss());await restorable.click();await expect(label).toHaveValue("Unsaved price label");expect(calls.restoreCalls).toBe(0);
  page.once("dialog",(dialog)=>dialog.accept());await restorable.click();await expect(label).toHaveValue("Earlier DJ label");await expect(commonAnswer).toHaveValue("Unsaved FAQ answer");expect(calls.restoreCalls).toBe(1);
  await label.fill("Another unsaved label");page.once("dialog",(dialog)=>dialog.dismiss());await page.getByRole("button",{name:"Reload saved pricing"}).click();await expect(label).toHaveValue("Another unsaved label");page.once("dialog",(dialog)=>dialog.accept());await page.getByRole("button",{name:"Reload saved pricing"}).click();await expect(label).toHaveValue("Earlier DJ label");await expect(commonAnswer).toHaveValue("Unsaved FAQ answer");
  page.once("dialog",(dialog)=>dialog.dismiss());await page.getByRole("link",{name:"Inbox"}).first().click();await expect(page.getByRole("heading",{name:"Pricing & FAQs"})).toBeVisible();
});

test("availability hides navigation, direct routes degrade gracefully, and uninitialized stores show staff-safe setup copy",async({page})=>{
  await mock(page,{availability:{available:false,reason:"binding_missing"}});await login(page);await expect(page.getByRole("link",{name:"Website"})).toHaveCount(0);await page.evaluate(()=>{window.location.hash="#/website";});await expect(page.getByRole("heading",{name:"Website management unavailable"})).toBeVisible();await expect(page.getByText(/database is not connected/i)).toBeVisible();
});

test("unauthorized staff cannot reveal Website navigation and initialized availability is not enough",async({page})=>{
  await mock(page,{actor:responder});await login(page,responder);await expect(page.getByRole("link",{name:"Website"})).toHaveCount(0);await page.evaluate(()=>{window.location.hash="#/website";});await expect(page.getByRole("heading",{name:"Inbox"})).toBeVisible();
});

test("enabled but uninitialized CMS shows a staff-facing setup requirement",async({page})=>{
  await mock(page,{initialized:false});await login(page);await page.getByRole("link",{name:"Website"}).first().click();await expect(page.getByRole("heading",{name:"Website content setup required"})).toBeVisible();await expect(page.getByText(/Ask an administrator or developer/)).toBeVisible();await expect(page.locator("body")).not.toContainText("wrangler");
});

async function json(route:Route,body:unknown,status=200){await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});}

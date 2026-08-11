import { expect,test,type Page, type Route } from "@playwright/test";

const responder={ id:"responder_test_a",display_label:"Test Responder A",active:1,available:0,currently_available:0,heartbeat_at:null,expires_at:null };
const inquiry={ id:"inq_test_wedding",workflow_state:"new",source_channel:"website",created_at:"2026-08-10T17:00:00Z",updated_at:"2026-08-10T17:00:00Z",full_name:"Synthetic Wedding Customer",event_id:"evt_test_wedding",event_family:"Wedding",start_date:"2026-09-12",end_date:null,start_time:null,end_time:null,venue_location:"Synthetic Garden Venue",blocks_capacity:0,scheduling_state:"tentative",services:"DJ|Photography",assignee_labels:null,assignee_ids:null };
const assessment={ status:"review_required",capacity:1,blockingOverlapCount:0,conflicts:[] };
const chatConversation={id:"conversation_mobile",provider:"native_web",external_conversation_id:null,channel_state:"open",updated_at:"2026-08-11T17:00:00Z",inquiry_id:null,event_id:null,full_name:"Synthetic Chat Customer",event_family:null,start_date:null,assigned_responder_id:null,last_message_at:"2026-08-11T17:00:00Z",unread_count:1};
const chatMessage={id:"message_mobile",client_message_id:"client_mobile",sequence:1,sender_kind:"customer",sender_responder_id:null,sender_label:null,body:"Synthetic mobile chat message",created_at:"2026-08-11T17:00:00Z"};

async function mockApi(page:Page,options:{ mutationFailure?:boolean;heartbeatDelayMs?:number;chatConversation?:boolean }={}){
  let chatRead=false;
  const calls:string[]=[];
  await page.route("http://127.0.0.1:8787/**",async(route:Route)=>{
    const request=route.request();const url=new URL(request.url());calls.push(`${request.method()} ${url.pathname}`);
    if(request.headers().authorization!=="Bearer test-token")return json(route,401,{ ok:false,error:{ code:"unauthorized",message:"Unauthorized" } });
    if(options.mutationFailure&&request.method()!=="GET")return json(route,500,{ ok:false,error:{ code:"test_error",message:"Synthetic server failure" } });
    if(url.pathname==="/v1/internal/responders")return json(route,200,{ ok:true,responders:[responder] });
    if(url.pathname==="/v1/internal/status")return json(route,200,{ ok:true,chat:{ state:"async",label:"Send us a DM",destinationUrl:null,provider:null },activeResponders:[],messaging:{ configured:false,provider:null },presenceTimeoutSeconds:120,eventCapacity:1 });
    if(url.pathname==="/v1/internal/inbox"){
      const rows=url.searchParams.get("query")==="nothing"?[]:[inquiry];
      return json(route,200,{ ok:true,inquiries:rows,page:{ limit:25,offset:0,total:rows.length,hasMore:false } });
    }
    if(url.pathname==="/v1/internal/schedule")return json(route,200,{ ok:true,range:{ start:url.searchParams.get("start"),end:url.searchParams.get("end") },capacity:1,events:[{ ...inquiry,inquiry_id:inquiry.id,assessment }] });
    if(url.pathname==="/v1/internal/conversations")return json(route,200,{ ok:true,conversations:options.chatConversation?[{...chatConversation,unread_count:chatRead?0:1}]:[] });
    if(url.pathname===`/v1/internal/conversations/${chatConversation.id}`){chatRead=true;return json(route,200,{ok:true,conversation:{...chatConversation,unread_count:0,email:"chat@example.test",phone:null,assigned_responder_label:null,created_at:"2026-08-11T17:00:00Z"},messages:[chatMessage],activity:[]});}
    if(url.pathname===`/v1/internal/conversations/${chatConversation.id}/messages`)return json(route,201,{ok:true,message:{...chatMessage,id:"reply_mobile",client_message_id:"reply_client",sequence:2,sender_kind:"responder",body:request.postDataJSON().body}});
    if(url.pathname===`/v1/internal/inquiries/${inquiry.id}`)return json(route,200,{ ok:true,inquiry:{ ...inquiry,email:"synthetic@example.test",phone:null,preferred_contact:"email",guest_count:100,customer_note:"Synthetic inquiry details." },services:[{ service_name:"DJ" }],assignments:[],notes:[],activities:[],conversations:[] });
    if(url.pathname.endsWith("/conflicts"))return json(route,200,{ ok:true,assessment });
    if(url.pathname==="/v1/internal/presence/heartbeat"){
      const body=request.postDataJSON() as { available:boolean };
      if(options.heartbeatDelayMs)await new Promise((resolve)=>setTimeout(resolve,options.heartbeatDelayMs));
      return json(route,200,{ ok:true,state:body.available?"available":"unavailable",expiresAt:"2026-08-10T17:02:00Z" });
    }
    return json(route,200,{ ok:true });
  });
  return calls;
}

async function login(page:Page){
  await page.goto("/");
  await page.getByLabel("Development API token").fill("test-token");
  await page.getByRole("button",{ name:"Connect to Local Operations" }).click();
  await page.getByLabel("Act as responder").selectOption(responder.id);
  await page.getByRole("button",{ name:"Open Staff Workspace" }).click();
  await expect(page.getByRole("heading",{ name:"Inquiry Inbox" })).toBeVisible();
}

test("inbox, search, detail, assignment, note, and scheduling status work",async({ page })=>{
  const calls=await mockApi(page);await login(page);
  await expect(page.getByText("Synthetic Wedding Customer")).toBeVisible();
  await page.getByLabel("Search inquiries").fill("nothing");
  await expect(page.getByText("No matching inquiries")).toBeVisible();
  await page.getByLabel("Search inquiries").fill("");
  await page.getByText("Synthetic Wedding Customer").click();
  await expect(page.getByRole("heading",{ name:"Scheduling Review" })).toBeVisible();
  await expect(page.getByText("Needs review").first()).toBeVisible();
  await page.getByRole("button",{ name:"Assign to Me" }).click();
  await expect(page.getByText("Saved successfully.")).toBeVisible();
  await page.getByLabel("Add internal note").fill("Synthetic internal follow-up note.");
  await page.getByRole("button",{ name:"Save Internal Note" }).click();
  await expect(page.getByText("Saved successfully.")).toBeVisible();
  expect(calls).toContain("PATCH /v1/internal/inquiries/inq_test_wedding/assignment");
  expect(calls).toContain("POST /v1/internal/inquiries/inq_test_wedding/notes");
});

test("availability starts a heartbeat, updates status, and stops explicitly",async({ page })=>{
  const calls=await mockApi(page,{heartbeatDelayMs:250});await login(page);
  await page.getByRole("link",{ name:/Status/ }).click();
  await page.getByRole("button",{ name:/Not available/ }).click();
  await expect(page.getByText("Connecting…").first()).toBeVisible();
  await expect(page.getByText("Available / Live").first()).toBeVisible();
  await page.getByRole("button",{ name:/Available \/ Live/ }).click();
  await expect(page.getByText("Not available").first()).toBeVisible();
  expect(calls.filter((call)=>call==="POST /v1/internal/presence/heartbeat")).toHaveLength(2);
});

test("mutation failures are visible and do not discard note text",async({ page })=>{
  await mockApi(page,{ mutationFailure:true });await login(page);
  await page.getByText("Synthetic Wedding Customer").click();
  const note=page.getByLabel("Add internal note");await note.fill("Keep this note after failure.");
  await page.getByRole("button",{ name:"Save Internal Note" }).click();
  await expect(page.getByText(/Not saved: Synthetic server failure/)).toBeVisible();
  await expect(note).toHaveValue("Keep this note after failure.");
});

test("mobile primary navigation remains usable",async({ page },testInfo)=>{
  test.skip(testInfo.project.name!=="staff-mobile","Mobile-only behavior");
  await mockApi(page);await login(page);
  const nav=page.getByRole("navigation",{ name:"Primary" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link",{ name:"Schedule" }).click();
  await expect(page.getByRole("heading",{ name:"Schedule" })).toBeVisible();
  await nav.getByRole("link",{ name:"Chat" }).click();
  await expect(page.getByRole("heading",{ name:"Chat" })).toBeVisible();
});

test("mobile conversation tap opens detail, supports reply, and returns read to inbox",async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="staff-mobile","Mobile-only behavior");
  const calls=await mockApi(page,{chatConversation:true});await login(page);
  await page.getByRole("link",{name:"Chat"}).click();
  const row=page.getByRole("button",{name:/Synthetic Chat Customer/});await expect(row).toContainText("1 unread");await row.click();
  await expect(page.getByRole("heading",{name:"Synthetic Chat Customer"})).toBeVisible();await expect(page.getByText("Synthetic mobile chat message")).toBeVisible();
  const reply=page.getByLabel("Reply");await expect(reply).toBeVisible();await reply.fill("Synthetic mobile staff reply");await page.getByRole("button",{name:"Send reply"}).click();
  expect(calls).toContain("POST /v1/internal/conversations/conversation_mobile/messages");
  await page.getByRole("button",{name:"Conversations"}).click();await expect(row).toBeVisible();await expect(row).toContainText("Read");
});

test("capture staff review screens",async({ page },testInfo)=>{
  await mockApi(page);await login(page);
  const size=testInfo.project.name==="staff-mobile"?"mobile":"desktop";
  await page.screenshot({ path:"artifacts/staff-app/"+size+"-inbox.png",fullPage:true });
  await page.getByText("Synthetic Wedding Customer").click();
  await page.screenshot({ path:"artifacts/staff-app/"+size+"-inquiry-detail.png",fullPage:true });
  if(size==="desktop"){
    await page.getByRole("link",{ name:"Schedule" }).click();
    await page.screenshot({ path:"artifacts/staff-app/desktop-schedule.png",fullPage:true });
    await page.getByRole("link",{ name:"Chat" }).click();
    await page.screenshot({ path:"artifacts/staff-app/desktop-chat.png",fullPage:true });
  }
  await page.getByRole("link",{ name:/Status/ }).click();
  await page.screenshot({ path:"artifacts/staff-app/"+size+"-responder-status.png",fullPage:true });
});

async function json(route:Route,status:number,body:unknown){await route.fulfill({ status,contentType:"application/json",body:JSON.stringify(body) });}

import { expect,test,type Page,type Route } from "@playwright/test";

const responder={id:"responder_moses",display_label:"Consulting Responder",active:1,available:0,currently_available:0,heartbeat_at:null,expires_at:null};
const inquiry={id:"inq_consulting",workflow_state:"new",source_channel:"consulting_web",created_at:"2026-08-17T17:00:00Z",updated_at:"2026-08-17T17:00:00Z",full_name:"Consulting Customer",event_id:null,event_family:null,start_date:null,end_date:null,start_time:null,end_time:null,venue_location:null,blocks_capacity:null,scheduling_state:null,services:null,assignee_labels:null,assignee_ids:null,consulting_organization:"Example Organization",consulting_service_area:"Growth strategy",consulting_situation:"The team needs a clearer route to market.",consulting_desired_outcome:"A practical 90-day operating plan.",consulting_referral_source:"Trusted referral"};

async function mockApi(page:Page){
  const calls:string[]=[];
  await page.route("http://127.0.0.1:8787/**",async(route:Route)=>{
    const request=route.request();const url=new URL(request.url());calls.push(`${request.method()} ${url.pathname}`);
    if(request.headers().authorization!=="Bearer test-token")return json(route,401,{ok:false,error:{code:"unauthorized",message:"Unauthorized"}});
    if(url.pathname==="/v1/internal/responders")return json(route,200,{ok:true,responders:[responder]});
    if(url.pathname==="/v1/internal/status")return json(route,200,{ok:true,chat:{state:"async",label:"Send a message",destinationUrl:null,provider:null},activeResponders:[],messaging:{configured:false,provider:null},presenceTimeoutSeconds:120,eventCapacity:1});
    if(url.pathname==="/v1/internal/push/config")return json(route,200,{ok:true,configured:false,publicKey:null,subscriptionCount:0});
    if(url.pathname==="/v1/internal/inbox")return json(route,200,{ok:true,inquiries:[inquiry],page:{limit:25,offset:0,total:1,hasMore:false}});
    if(url.pathname==="/v1/internal/conversations")return json(route,200,{ok:true,conversations:[]});
    if(url.pathname===`/v1/internal/inquiries/${inquiry.id}`)return json(route,200,{ok:true,inquiry:{...inquiry,email:"customer@example.test",phone:null,preferred_contact:"email",customer_note:null},event:null,consulting:{inquiry_id:inquiry.id,organization:"Example Organization",offer_service_area:"Growth strategy",situation_problem:"The team needs a clearer route to market.",desired_outcome:"A practical 90-day operating plan.",timeline:"This quarter",budget:"To be determined",country_region:"United States",referral_source:"Trusted referral",created_at:inquiry.created_at,updated_at:inquiry.updated_at},intakeSubmissions:[],services:[],assignments:[],notes:[],activities:[],conversations:[]});
    return json(route,200,{ok:true});
  });
  return calls;
}

async function login(page:Page){
  await page.goto("/");
  await expect(page).toHaveTitle(/Moses Operations/);
  await page.getByLabel("Development API token").fill("test-token");
  await page.getByRole("button",{name:"Connect to Local Operations"}).click();
  await page.getByLabel("Act as responder").selectOption(responder.id);
  await page.getByRole("button",{name:"Open Staff Workspace"}).click();
}

test("Moses profile renders an eventless consulting inquiry without event module calls",async({page})=>{
  const calls=await mockApi(page);await login(page);
  await expect(page.locator(".brand")).toContainText("Moses");
  await expect(page.locator(".brand")).toContainText("Operations");
  await expect(page.getByRole("navigation",{name:"Primary"}).getByRole("link",{name:"Schedule"})).toHaveCount(0);
  await expect(page.getByText("Focus Lab")).toHaveCount(0);
  await page.getByText("Consulting Customer").click();
  await expect(page.getByRole("heading",{name:"Consulting",exact:true})).toBeVisible();
  await expect(page.getByText("Example Organization")).toBeVisible();
  await expect(page.getByText("A practical 90-day operating plan.")).toBeVisible();
  await expect(page.getByRole("heading",{name:"Workflow"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Internal Notes"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Activity"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Event"})).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"Capacity"})).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"Scheduling Review"})).toHaveCount(0);
  expect(calls.some((call)=>/\/(schedule|conflicts|capacity)(?:\/|$)/.test(call))).toBe(false);
});

async function json(route:Route,status:number,body:unknown){await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});}

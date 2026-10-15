import { env,exports } from "cloudflare:workers";
import { describe,expect,it,vi } from "vitest";

const token="development-test-token-00000000";
const auth={Authorization:"Bearer "+token,"X-Development-Responder-Id":"rsp_console_status"};

type WebsiteAvailability={available:boolean;reason:"available"|"business_disabled"|"configuration_disabled"|"binding_missing"};
type StatusResponse={
  ok:true;
  chat:{state:string;label:string;destinationUrl:string|null};
  activeResponders:Array<{id:string;display_label:string;heartbeat_at:string;expires_at:string}>;
  messaging:{configured:boolean;provider:string|null};
  presenceTimeoutSeconds:number;
  eventCapacity:number;
  websiteManagement:WebsiteAvailability;
};

function status(overrides:Partial<StatusResponse>={}):StatusResponse{
  return{
    ok:true,
    chat:{state:"async",label:"Message",destinationUrl:null},
    activeResponders:[{id:"rsp_manager",display_label:"Manager",heartbeat_at:"2026-10-15T12:00:00.000Z",expires_at:"2026-10-15T12:02:00.000Z"}],
    messaging:{configured:true,provider:"test-shared-inbox"},
    presenceTimeoutSeconds:120,
    eventCapacity:1,
    websiteManagement:{available:true,reason:"available"},
    ...overrides,
  };
}

function bindApiStatus(authoritative:StatusResponse){
  const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const request=input instanceof Request?input:new Request(input,init);
    if(request.headers.get("Authorization")!=="Bearer "+token){
      return Response.json({ok:false,error:{code:"authentication_required",message:"Cloudflare Access authentication is required"}},{status:401});
    }
    return Response.json(authoritative);
  });
  env.CHAT_API={fetch} as unknown as Fetcher;
  return fetch;
}

async function requestStatus(headers:HeadersInit={}){
  return exports.default.fetch(new Request("https://staff.example.test/v1/internal/status",{headers}));
}

describe("console status routing",()=>{
  it("uses the Focus API status even when the console has no CMS binding and preserves every status field",async()=>{
    const originalChatApi=env.CHAT_API;const originalCmsDb=env.CMS_DB;const originalCmsEnabled=env.CMS_ENABLED;const originalProfile=env.BUSINESS_PROFILE;
    const authoritative=status();
    try{
      env.BUSINESS_PROFILE="focus";env.CMS_ENABLED="false";env.CMS_DB=undefined;
      const fetch=bindApiStatus(authoritative);
      const response=await requestStatus(auth);
      expect(response.status).toBe(200);await expect(response.json()).resolves.toEqual(authoritative);
      expect(fetch).toHaveBeenCalledOnce();
      const forwarded=fetch.mock.calls[0]![0];expect(forwarded).toBeInstanceOf(Request);
      expect((forwarded as Request).headers.get("Authorization")).toBe("Bearer "+token);
      expect(new URL((forwarded as Request).url).pathname).toBe("/v1/internal/status");
    }finally{env.CHAT_API=originalChatApi;env.CMS_DB=originalCmsDb;env.CMS_ENABLED=originalCmsEnabled;env.BUSINESS_PROFILE=originalProfile;}
  });

  it("preserves API-owned Moses isolation and delegates authentication",async()=>{
    const originalChatApi=env.CHAT_API;const originalCmsDb=env.CMS_DB;const originalProfile=env.BUSINESS_PROFILE;
    const authoritative=status({websiteManagement:{available:false,reason:"business_disabled"}});
    try{
      env.BUSINESS_PROFILE="moses";env.CMS_DB=undefined;
      bindApiStatus(authoritative);
      await expect((await requestStatus(auth)).json()).resolves.toEqual(authoritative);
      const anonymous=await requestStatus();expect(anonymous.status).toBe(401);
      await expect(anonymous.json()).resolves.toMatchObject({error:{code:"authentication_required"}});
    }finally{env.CHAT_API=originalChatApi;env.CMS_DB=originalCmsDb;env.BUSINESS_PROFILE=originalProfile;}
  });
});

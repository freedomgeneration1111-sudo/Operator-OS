import {env,exports} from "cloudflare:workers";
import {afterEach,beforeEach,describe,expect,it} from "vitest";

const previousProfile=env.BUSINESS_PROFILE;
const previousPublicApi=env.PUBLIC_API_ENABLED;
const auth={Authorization:"Bearer development-test-token-00000000","X-Development-Responder-Id":"responder-profile"};

beforeEach(async()=>{
  env.BUSINESS_PROFILE="moses";env.PUBLIC_API_ENABLED="false";
  await env.DB.prepare("INSERT OR IGNORE INTO responders (id,display_label,active,role,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .bind("responder-profile","Profile tester",1,"manager","2026-01-01T00:00:00.000Z","2026-01-01T00:00:00.000Z").run();
});
afterEach(()=>{env.BUSINESS_PROFILE=previousProfile;env.PUBLIC_API_ENABLED=previousPublicApi;});

describe("Moses deployment selection",()=>{
  it("identifies itself without Focus presentation",async()=>{
    const response=await exports.default.fetch("https://moses.example.test/health");
    expect(await response.json()).toMatchObject({ok:true,service:"operator-os-moses",business:"moses"});
  });
  it("fails closed for public event intake and public chat",async()=>{
    expect((await exports.default.fetch("https://moses.example.test/v1/inquiries",{method:"POST"})).status).toBe(404);
    const chat=await exports.default.fetch("https://moses.example.test/v1/chat/status");
    expect(chat.status).toBe(404);expect(await chat.json()).toMatchObject({error:{code:"module_disabled"}});
  });
  it("does not expose schedule or capacity modules",async()=>{
    const schedule=await exports.default.fetch("https://moses.example.test/v1/internal/schedule",{headers:auth});
    const capacity=await exports.default.fetch("https://moses.example.test/v1/internal/inquiries/anything/capacity",{method:"PATCH",headers:auth});
    expect(schedule.status).toBe(404);expect(await schedule.json()).toMatchObject({error:{code:"module_disabled"}});
    expect(capacity.status).toBe(404);expect(await capacity.json()).toMatchObject({error:{code:"module_disabled"}});
  });
});

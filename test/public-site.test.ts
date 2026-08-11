import {describe,expect,it,vi} from "vitest";
import {handlePublicSite} from "../src/public-site";

describe("public staging same-origin facade",()=>{
  it("forwards inquiry requests through the operations service binding",async()=>{const operations={fetch:vi.fn().mockResolvedValue(new Response("api",{status:201}))};const assets={fetch:vi.fn().mockResolvedValue(new Response("asset"))};const response=await handlePublicSite(new Request("https://public.example.test/v1/inquiries",{method:"POST"}),{OPERATIONS_API:operations,ASSETS:assets});expect(response.status).toBe(201);expect(operations.fetch).toHaveBeenCalledOnce();expect(assets.fetch).not.toHaveBeenCalled();});
  it("serves non-API paths from static assets",async()=>{const operations={fetch:vi.fn()};const assets={fetch:vi.fn().mockResolvedValue(new Response("asset"))};const response=await handlePublicSite(new Request("https://public.example.test/check-availability/"),{OPERATIONS_API:operations,ASSETS:assets});expect(await response.text()).toBe("asset");expect(operations.fetch).not.toHaveBeenCalled();});
});

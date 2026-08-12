import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const source=readFileSync("operations/staff-app/public/sw.js","utf8");
describe("staff service worker",()=>{
  it("handles push and opens the relevant conversation",()=>{expect(source).toContain('addEventListener("push"');expect(source).toContain('addEventListener("notificationclick"');expect(source).toContain("/#/chat?conversation=");expect(source).toContain("showNotification(title");});
  it("never caches internal API or Cloudflare Access responses",()=>{expect(source).toContain('url.pathname.startsWith("/v1/")');expect(source).toContain('url.pathname.startsWith("/cdn-cgi/access/")');expect(source).toContain('fetch(request,{cache:"no-store"})');});
  it("feature-detects app badging",()=>{expect(source).toContain('typeof self.navigator?.setAppBadge==="function"');expect(source).toContain('typeof self.navigator?.clearAppBadge==="function"');});
  it("reports a diagnostic version and activates updates immediately",()=>{expect(source).toContain('VERSION="focus-lab-ops-sw-v4"');expect(source).toContain("focuslab:push-diagnostics");expect(source).toContain("self.skipWaiting()");});
});

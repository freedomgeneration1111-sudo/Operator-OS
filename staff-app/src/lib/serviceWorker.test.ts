import { describe,expect,it } from "vitest";
import { resolveClientBusinessProfile } from "../../../business-profiles.mts";
import { serviceWorkerFor } from "./service-worker-source.mts";

const profile=(key:"focus"|"moses")=>resolveClientBusinessProfile(key);
describe("staff service worker",()=>{
  const source=serviceWorkerFor(profile("focus"));
  it("handles push and opens the relevant conversation",()=>{expect(source).toContain('addEventListener("push"');expect(source).toContain('addEventListener("notificationclick"');expect(source).toContain("/#/chat?conversation=");expect(source).toContain("showNotification(title");});
  it("never caches internal API or Cloudflare Access responses",()=>{expect(source).toContain('url.pathname.startsWith("/v1/")');expect(source).toContain('url.pathname.startsWith("/cdn-cgi/access/")');expect(source).toContain('fetch(request,{cache:"no-store"})');});
  it("feature-detects app badging",()=>{expect(source).toContain('typeof self.navigator?.setAppBadge==="function"');expect(source).toContain('typeof self.navigator?.clearAppBadge==="function"');});
  it("reports a profile-specific diagnostic version and activates updates immediately",()=>{expect(source).toContain('operator-os-focus-sw-v5');expect(source).toContain("operator:push-diagnostics");expect(source).toContain("self.skipWaiting()");});
  it("generates a Moses worker with no Focus branding",()=>{expect(serviceWorkerFor(profile("moses"))).not.toMatch(/Focus Lab|FocusLab|focus-lab/);});
});

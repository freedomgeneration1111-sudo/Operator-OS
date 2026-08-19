import { env,exports } from "cloudflare:workers";
const SELF = exports.default;
import { beforeEach,describe,expect,it,vi } from "vitest";
import { AVAILABILITY_CACHE_KEY } from "../src/availability-cache";
import { handleAvailability,resolveAvailability,type AvailabilityCache } from "../src/availability-api";

const cache: AvailabilityCache = { generatedAt: "2026-09-01T00:00:00.000Z",timeZone: "America/Chicago",windowStart: "2026-09-01",windowEnd: "2026-09-30",busyDates: ["2026-09-10"] };

describe("resolveAvailability",() => {
  it("reports unknown when there is no cache",() => expect(resolveAvailability(null,"2026-09-10","2026-09-01")).toEqual({ ok: true,date: "2026-09-10",status: "unknown" }));
  it("reports unknown for a date outside the cached window",() => expect(resolveAvailability(cache,"2027-01-01","2026-09-01").status).toBe("unknown"));
  it("reports available for an uncached-busy in-window date",() => expect(resolveAvailability(cache,"2026-09-15","2026-09-01")).toEqual({ ok: true,date: "2026-09-15",status: "available" }));
  it("reports unavailable with nearby available alternatives for a busy date",() => {
    expect(resolveAvailability(cache,"2026-09-10","2026-09-01")).toEqual({
      ok: true,date: "2026-09-10",status: "unavailable",
      nearby: [{ date: "2026-09-11",status: "available" },{ date: "2026-09-09",status: "available" },{ date: "2026-09-12",status: "available" }],
    });
  });
  it("never suggests a nearby date before today or before the window start",() => {
    const edgeCache: AvailabilityCache = { ...cache,windowStart: "2026-09-08",busyDates: ["2026-09-08"] };
    const result = resolveAvailability(edgeCache,"2026-09-08","2026-09-08");
    expect(result.nearby?.every((entry) => entry.date >= "2026-09-08")).toBe(true);
    expect(result.nearby).toEqual([{ date: "2026-09-09",status: "available" },{ date: "2026-09-10",status: "available" },{ date: "2026-09-11",status: "available" }]);
  });
  it("skips over consecutive busy dates when finding nearby alternatives",() => {
    const busyRun: AvailabilityCache = { ...cache,busyDates: ["2026-09-09","2026-09-10","2026-09-11"] };
    const result = resolveAvailability(busyRun,"2026-09-10","2026-09-01");
    expect(result.nearby?.map((entry) => entry.date)).not.toContain("2026-09-09");
    expect(result.nearby?.map((entry) => entry.date)).not.toContain("2026-09-11");
  });
});

describe("handleAvailability",() => {
  const now = new Date("2026-09-01T00:10:00.000Z"); // within the 30-minute staleness threshold of cache.generatedAt
  beforeEach(async () => { await env.AVAILABILITY_CACHE.put(AVAILABILITY_CACHE_KEY,JSON.stringify(cache)); });

  it("rejects a missing or malformed date with a validation error",async () => {
    const request = new Request("https://operations.example.test/v1/availability",{ headers: { "CF-Connecting-IP": "192.0.2.10" } });
    await expect(handleAvailability(request,env,now)).rejects.toMatchObject({ status: 422,code: "validation_error" });
    const bad = new Request("https://operations.example.test/v1/availability?date=09-10-2026",{ headers: { "CF-Connecting-IP": "192.0.2.11" } });
    await expect(handleAvailability(bad,env,now)).rejects.toMatchObject({ status: 422,code: "validation_error" });
  });

  it("resolves an available date from the cache",async () => {
    const request = new Request("https://operations.example.test/v1/availability?date=2026-09-15",{ headers: { "CF-Connecting-IP": "192.0.2.12" } });
    const response = await handleAvailability(request,env,now);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true,date: "2026-09-15",status: "available" });
  });

  it("falls back to unknown when the cache is older than the staleness threshold",async () => {
    const request = new Request("https://operations.example.test/v1/availability?date=2026-09-15",{ headers: { "CF-Connecting-IP": "192.0.2.13" } });
    const wayLater = new Date("2026-09-06T12:00:00.000Z"); // >30 minutes after generatedAt
    expect(await (await handleAvailability(request,{ ...env,AVAILABILITY_CACHE_STALE_MINUTES: "30" },wayLater)).json()).toEqual({ ok: true,date: "2026-09-15",status: "unknown" });
  });

  it("never exposes raw event/busy-interval data — only date and status fields",async () => {
    const request = new Request("https://operations.example.test/v1/availability?date=2026-09-10",{ headers: { "CF-Connecting-IP": "192.0.2.14" } });
    const body = await (await handleAvailability(request,env,now)).json() as Record<string,unknown>;
    expect(Object.keys(body).sort()).toEqual(["date","nearby","ok","status"]);
  });

  it("returns 429 when the rate-limit binding denies the request",async () => {
    const request = new Request("https://operations.example.test/v1/availability?date=2026-09-15",{ headers: { "CF-Connecting-IP": "192.0.2.15" } });
    const limited = { ...env,AVAILABILITY_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) } };
    await expect(handleAvailability(request,limited,now)).rejects.toMatchObject({ status: 429,code: "rate_limited" });
  });

  it("fails closed without a rate-limit binding outside development",async () => {
    const request = new Request("https://operations.example.test/v1/availability?date=2026-09-15",{ headers: { "CF-Connecting-IP": "192.0.2.16" } });
    const noLimiter = { ...env,AVAILABILITY_RATE_LIMITER: undefined,ENVIRONMENT: "staging" };
    await expect(handleAvailability(request,noLimiter,now)).rejects.toMatchObject({ status: 503 });
  });

  it("allows requests without a rate-limit binding in development",async () => {
    const request = new Request("https://operations.example.test/v1/availability?date=2026-09-15",{ headers: { "CF-Connecting-IP": "192.0.2.17" } });
    const devNoLimiter = { ...env,AVAILABILITY_RATE_LIMITER: undefined,ENVIRONMENT: "development" };
    expect((await handleAvailability(request,devNoLimiter,now)).status).toBe(200);
  });
});

describe("GET /v1/availability (routed)",() => {
  const publicOrigin = "http://localhost:3000";
  beforeEach(async () => { await env.AVAILABILITY_CACHE.put(AVAILABILITY_CACHE_KEY,JSON.stringify(cache)); });

  it("answers through the public router with CORS and no-Google-on-request-path behavior",async () => {
    const response = await SELF.fetch("https://operations.example.test/v1/availability?date=2026-09-15",{ headers: { Origin: publicOrigin,"CF-Connecting-IP": "192.0.2.20" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(publicOrigin);
    expect(await response.json()).toEqual({ ok: true,date: "2026-09-15",status: "available" });
  });

  it("returns 422 with CORS for a malformed date through the full router",async () => {
    const response = await SELF.fetch("https://operations.example.test/v1/availability?date=not-a-date",{ headers: { Origin: publicOrigin,"CF-Connecting-IP": "192.0.2.22" } });
    expect(response.status).toBe(422);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(publicOrigin);
  });
});

import { env } from "cloudflare:workers";
import { describe,expect,it } from "vitest";
import { AVAILABILITY_CACHE_KEY,reduceBusyDates,readAvailabilityCache,refreshAvailabilityCache,type AvailabilityCache } from "../src/availability-cache";
import { isoDatesBetween } from "../src/availability-timezone";
import { generateTestServiceAccountKey } from "./helpers/test-service-account";

describe("reduceBusyDates",() => {
  const dates = isoDatesBetween("2026-06-10","2026-06-14");

  it("marks only the day a busy interval overlaps",() => {
    const busy = reduceBusyDates([{ start: "2026-06-12T18:00:00Z",end: "2026-06-12T22:00:00Z" }],dates,"America/Chicago");
    expect(busy).toEqual(["2026-06-12"]);
  });
  it("marks every day a multi-day interval touches",() => {
    const busy = reduceBusyDates([{ start: "2026-06-11T05:00:00Z",end: "2026-06-13T05:00:00Z" }],dates,"America/Chicago");
    expect(busy).toEqual(["2026-06-11","2026-06-12"]);
  });
  it("does not mark a day the interval only touches at its exact boundary",() => {
    // Ends exactly at 2026-06-12's Central midnight (05:00Z) — half-open, so 06-12 stays free.
    const busy = reduceBusyDates([{ start: "2026-06-11T05:00:00Z",end: "2026-06-12T05:00:00Z" }],dates,"America/Chicago");
    expect(busy).toEqual(["2026-06-11"]);
  });
  it("ignores intervals entirely outside the requested dates",() => {
    expect(reduceBusyDates([{ start: "2026-01-01T00:00:00Z",end: "2026-01-02T00:00:00Z" }],dates,"America/Chicago")).toEqual([]);
  });
  it("handles the DST spring-forward day correctly",() => {
    // Busy 01:30-02:30 Central on the 23-hour day itself is 07:30-08:30Z.
    const busy = reduceBusyDates([{ start: "2026-03-08T07:30:00Z",end: "2026-03-08T08:30:00Z" }],["2026-03-07","2026-03-08","2026-03-09"],"America/Chicago");
    expect(busy).toEqual(["2026-03-08"]);
  });
});

describe("refreshAvailabilityCache",() => {
  it("writes a reduced busy-date cache to KV from a live freebusy response",async () => {
    const key = await generateTestServiceAccountKey();
    const fetcher = (async (input: RequestInfo | URL) => {
      if (String(input) === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "t" }),{ status: 200 });
      return new Response(JSON.stringify({ calendars: { "bookings@example.test": { busy: [{ start: "2026-09-10T18:00:00Z",end: "2026-09-10T22:00:00Z" }] } } }),{ status: 200 });
    }) as typeof fetch;

    const now = new Date("2026-09-01T12:00:00.000Z");
    await refreshAvailabilityCache(
      { AVAILABILITY_CACHE: env.AVAILABILITY_CACHE,GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY: JSON.stringify(key),GOOGLE_CALENDAR_ID: "bookings@example.test",BUSINESS_TIMEZONE: "America/Chicago",AVAILABILITY_WINDOW_MONTHS: "1" },
      now,
      fetcher,
    );

    const cache = await readAvailabilityCache(env.AVAILABILITY_CACHE);
    expect(cache).not.toBeNull();
    expect(cache?.generatedAt).toBe(now.toISOString());
    expect(cache?.timeZone).toBe("America/Chicago");
    expect(cache?.windowStart).toBe("2026-09-01");
    expect(cache?.windowEnd).toBe("2026-10-01");
    expect(cache?.busyDates).toEqual(["2026-09-10"]);
  });

  it("no-ops silently when Google Calendar bindings are not configured",async () => {
    await env.AVAILABILITY_CACHE.delete(AVAILABILITY_CACHE_KEY);
    await refreshAvailabilityCache({ AVAILABILITY_CACHE: env.AVAILABILITY_CACHE });
    expect(await readAvailabilityCache(env.AVAILABILITY_CACHE)).toBeNull();
  });

  it("propagates a Google API failure so the caller can log it (never writes a partial cache)",async () => {
    const key = await generateTestServiceAccountKey();
    const fetcher = (async () => new Response("boom",{ status: 500 })) as typeof fetch;
    await env.AVAILABILITY_CACHE.delete(AVAILABILITY_CACHE_KEY);
    await expect(refreshAvailabilityCache(
      { AVAILABILITY_CACHE: env.AVAILABILITY_CACHE,GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY: JSON.stringify(key),GOOGLE_CALENDAR_ID: "bookings@example.test" },
      new Date(),
      fetcher,
    )).rejects.toThrow();
    expect(await readAvailabilityCache(env.AVAILABILITY_CACHE)).toBeNull();
  });
});

describe("readAvailabilityCache",() => {
  it("returns null when nothing has been cached yet",async () => {
    await env.AVAILABILITY_CACHE.delete(AVAILABILITY_CACHE_KEY);
    expect(await readAvailabilityCache(env.AVAILABILITY_CACHE)).toBeNull();
  });
  it("round-trips a stored cache",async () => {
    const cache: AvailabilityCache = { generatedAt: "2026-09-01T00:00:00.000Z",timeZone: "America/Chicago",windowStart: "2026-09-01",windowEnd: "2027-03-01",busyDates: ["2026-09-10"] };
    await env.AVAILABILITY_CACHE.put(AVAILABILITY_CACHE_KEY,JSON.stringify(cache));
    expect(await readAvailabilityCache(env.AVAILABILITY_CACHE)).toEqual(cache);
  });
});

import { describe,expect,it } from "vitest";
import { parseServiceAccountKey,queryFreeBusy } from "../src/google-calendar";
import { generateTestServiceAccountKey } from "./helpers/test-service-account";

describe("parseServiceAccountKey",() => {
  it("parses a valid key",async () => {
    const key = await generateTestServiceAccountKey();
    expect(parseServiceAccountKey(JSON.stringify(key))).toEqual(key);
  });
  it("rejects a key missing required fields",() => {
    expect(() => parseServiceAccountKey(JSON.stringify({ client_email: "only@example.test" }))).toThrow();
  });
  it("rejects invalid JSON",() => expect(() => parseServiceAccountKey("not json")).toThrow());
});

describe("queryFreeBusy",() => {
  it("exchanges the service-account JWT and returns busy intervals for the calendar",async () => {
    const key = await generateTestServiceAccountKey();
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL,init?: RequestInit) => {
      const url = String(input);calls.push(url);
      if (url === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
        expect(body.get("assertion")?.split(".")).toHaveLength(3);
        return new Response(JSON.stringify({ access_token: "test-access-token",expires_in: 3600 }),{ status: 200 });
      }
      if (url === "https://www.googleapis.com/calendar/v3/freebusy") {
        expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer test-access-token");
        const parsed = JSON.parse(String(init?.body));
        expect(parsed.items).toEqual([{ id: "bookings@example.test" }]);
        return new Response(JSON.stringify({ calendars: { "bookings@example.test": { busy: [{ start: "2026-09-01T00:00:00Z",end: "2026-09-02T00:00:00Z" }] } } }),{ status: 200 });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof fetch;

    const busy = await queryFreeBusy(key,"bookings@example.test","2026-09-01T00:00:00Z","2026-09-30T00:00:00Z",fetcher);
    expect(busy).toEqual([{ start: "2026-09-01T00:00:00Z",end: "2026-09-02T00:00:00Z" }]);
    expect(calls).toEqual(["https://oauth2.googleapis.com/token","https://www.googleapis.com/calendar/v3/freebusy"]);
  });

  it("throws when the token exchange fails",async () => {
    const key = await generateTestServiceAccountKey();
    const fetcher = (async () => new Response("denied",{ status: 401 })) as typeof fetch;
    await expect(queryFreeBusy(key,"bookings@example.test","2026-09-01T00:00:00Z","2026-09-30T00:00:00Z",fetcher)).rejects.toThrow();
  });

  it("throws when the calendar itself reports an error",async () => {
    const key = await generateTestServiceAccountKey();
    const fetcher = (async (input: RequestInfo | URL) => {
      if (String(input) === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "t" }),{ status: 200 });
      return new Response(JSON.stringify({ calendars: { "bookings@example.test": { errors: [{ reason: "notFound" }] } } }),{ status: 200 });
    }) as typeof fetch;
    await expect(queryFreeBusy(key,"bookings@example.test","2026-09-01T00:00:00Z","2026-09-30T00:00:00Z",fetcher)).rejects.toThrow();
  });
});

import { describe,expect,it } from "vitest";
import { addDaysIso,addMonthsIso,isoDateInTimeZone,isoDatesBetween,zonedDayBoundsUtc } from "../src/availability-timezone";

describe("zonedDayBoundsUtc",() => {
  it("computes a normal 24-hour Central day",() => {
    expect(zonedDayBoundsUtc("2026-06-15","America/Chicago")).toEqual({ timeMinUtc: "2026-06-15T05:00:00.000Z",timeMaxUtc: "2026-06-16T05:00:00.000Z" });
  });
  it("shortens the spring-forward day to 23 hours",() => {
    const bounds = zonedDayBoundsUtc("2026-03-08","America/Chicago");
    expect(bounds).toEqual({ timeMinUtc: "2026-03-08T06:00:00.000Z",timeMaxUtc: "2026-03-09T05:00:00.000Z" });
    expect(Date.parse(bounds.timeMaxUtc) - Date.parse(bounds.timeMinUtc)).toBe(23 * 3_600_000);
  });
  it("lengthens the fall-back day to 25 hours",() => {
    const bounds = zonedDayBoundsUtc("2026-11-01","America/Chicago");
    expect(bounds).toEqual({ timeMinUtc: "2026-11-01T05:00:00.000Z",timeMaxUtc: "2026-11-02T06:00:00.000Z" });
    expect(Date.parse(bounds.timeMaxUtc) - Date.parse(bounds.timeMinUtc)).toBe(25 * 3_600_000);
  });
});

describe("addDaysIso / addMonthsIso",() => {
  it("rolls across a month boundary",() => expect(addDaysIso("2026-01-31",1)).toBe("2026-02-01"));
  it("rolls across a year boundary",() => expect(addDaysIso("2026-12-31",1)).toBe("2027-01-01"));
  it("subtracts days",() => expect(addDaysIso("2026-03-01",-1)).toBe("2026-02-28"));
  it("adds calendar months",() => expect(addMonthsIso("2026-08-19",6)).toBe("2027-02-19"));
});

describe("isoDateInTimeZone",() => {
  it("reads the local calendar date, not the UTC one, near midnight",() => {
    // 05:30 UTC on 2026-06-16 is still 2026-06-15 in America/Chicago (UTC-5 in summer).
    expect(isoDateInTimeZone(new Date("2026-06-16T04:30:00.000Z"),"America/Chicago")).toBe("2026-06-15");
    expect(isoDateInTimeZone(new Date("2026-06-16T06:30:00.000Z"),"America/Chicago")).toBe("2026-06-16");
  });
});

describe("isoDatesBetween",() => {
  it("is inclusive of both endpoints",() => expect(isoDatesBetween("2026-02-27","2026-03-01")).toEqual(["2026-02-27","2026-02-28","2026-03-01"]));
  it("returns a single date when start equals end",() => expect(isoDatesBetween("2026-06-01","2026-06-01")).toEqual(["2026-06-01"]));
});

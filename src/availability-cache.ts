import { addMonthsIso, isoDateInTimeZone, isoDatesBetween, zonedDayBoundsUtc } from "./availability-timezone";
import { parseServiceAccountKey, queryFreeBusy, type FreeBusyInterval } from "./google-calendar";

export type AvailabilityCache = { generatedAt: string; timeZone: string; windowStart: string; windowEnd: string; busyDates: string[] };
export type AvailabilityCacheEnv = {
  AVAILABILITY_CACHE?: KVNamespace;
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY?: string;
  GOOGLE_CALENDAR_ID?: string;
  BUSINESS_TIMEZONE?: string;
  AVAILABILITY_WINDOW_MONTHS?: string;
};

export const AVAILABILITY_CACHE_KEY = "availability:v1";
const DEFAULT_WINDOW_MONTHS = 6;
const DEFAULT_TIMEZONE = "America/Chicago";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Pure reduction: a calendar day is BUSY if any busy interval overlaps its zoned bounds. */
export function reduceBusyDates(intervals: FreeBusyInterval[], dates: string[], timeZone: string): string[] {
  const busyMs = intervals
    .map((interval) => ({ start: Date.parse(interval.start), end: Date.parse(interval.end) }))
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end));
  return dates.filter((date) => {
    const { timeMinUtc, timeMaxUtc } = zonedDayBoundsUtc(date, timeZone);
    const dayStart = Date.parse(timeMinUtc);
    const dayEnd = Date.parse(timeMaxUtc);
    return busyMs.some((interval) => interval.start < dayEnd && interval.end > dayStart);
  });
}

/** Cron-only. Fetches freebusy over the rolling window and writes the reduced busy-date set to KV. Never called on the request path. */
export async function refreshAvailabilityCache(env: AvailabilityCacheEnv, now: Date = new Date(), fetcher: typeof fetch = fetch): Promise<void> {
  if (!env.AVAILABILITY_CACHE || !env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY || !env.GOOGLE_CALENDAR_ID) return;
  const timeZone = env.BUSINESS_TIMEZONE ?? DEFAULT_TIMEZONE;
  const windowMonths = positiveInteger(env.AVAILABILITY_WINDOW_MONTHS, DEFAULT_WINDOW_MONTHS);
  const windowStart = isoDateInTimeZone(now, timeZone);
  const windowEnd = addMonthsIso(windowStart, windowMonths);

  const serviceAccount = parseServiceAccountKey(env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY);
  const { timeMinUtc } = zonedDayBoundsUtc(windowStart, timeZone);
  const { timeMaxUtc } = zonedDayBoundsUtc(windowEnd, timeZone);
  const busy = await queryFreeBusy(serviceAccount, env.GOOGLE_CALENDAR_ID, timeMinUtc, timeMaxUtc, fetcher);

  const cache: AvailabilityCache = {
    generatedAt: now.toISOString(), timeZone, windowStart, windowEnd,
    busyDates: reduceBusyDates(busy, isoDatesBetween(windowStart, windowEnd), timeZone),
  };
  await env.AVAILABILITY_CACHE.put(AVAILABILITY_CACHE_KEY, JSON.stringify(cache));
}

export async function readAvailabilityCache(kv: KVNamespace | undefined): Promise<AvailabilityCache | null> {
  if (!kv) return null;
  const stored = await kv.get<AvailabilityCache>(AVAILABILITY_CACHE_KEY, "json");
  return stored ?? null;
}

import { z } from "zod";
import { addDaysIso, isoDateInTimeZone, isoDatesBetween } from "./availability-timezone";
import { AVAILABILITY_CACHE_KEY, readAvailabilityCache, type AvailabilityCache } from "./availability-cache";
import { listBlockingWindows } from "./repository";
import type { SchedulingWindow } from "./scheduling";

export type AvailabilityStatus = "available" | "unavailable" | "unknown";
export type AvailabilityResponse = { ok: true; date: string; status: AvailabilityStatus; nearby?: { date: string; status: AvailabilityStatus }[] };

export type AvailabilityApiEnv = {
  DB?: D1Database;
  AVAILABILITY_CACHE?: KVNamespace;
  AVAILABILITY_RATE_LIMITER?: RateLimit;
  AVAILABILITY_CACHE_STALE_MINUTES?: string;
  ENVIRONMENT?: string;
};

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const NEARBY_COUNT = 3;
const NEARBY_RADIUS_DAYS = 21;

export class AvailabilityApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isFresh(cache: AvailabilityCache, now: Date, staleMinutes: number): boolean {
  const ageMs = now.getTime() - Date.parse(cache.generatedAt);
  return Number.isFinite(ageMs) && ageMs <= staleMinutes * 60_000;
}

/** Pure: expands capacity-blocking scheduling windows (fetched from D1 by the caller) to the individual ISO dates they cover. */
export function blockedDatesFromWindows(windows: SchedulingWindow[]): Set<string> {
  const dates = new Set<string>();
  for (const window of windows) {
    if (!window.startDate) continue;
    for (const date of isoDatesBetween(window.startDate, window.endDate ?? window.startDate)) dates.add(date);
  }
  return dates;
}

/**
 * Pure: resolves a single date's status plus, when booked, nearby available alternatives — no I/O.
 * `blockedDates` is the caller-supplied set of internally capacity-blocking dates (read from D1 in the
 * handler); it is unioned into the KV busy-date set before both the status decision and the nearby scan.
 */
export function resolveAvailability(
  cache: AvailabilityCache | null,
  date: string,
  todayIso: string,
  blockedDates: ReadonlySet<string> = new Set(),
): AvailabilityResponse {
  if (!cache || date < cache.windowStart || date > cache.windowEnd) return { ok: true, date, status: "unknown" };
  const busy = new Set(cache.busyDates);
  for (const blocked of blockedDates) busy.add(blocked);
  const status: AvailabilityStatus = busy.has(date) ? "unavailable" : "available";
  if (status !== "unavailable") return { ok: true, date, status };

  const nearby: { date: string; status: AvailabilityStatus }[] = [];
  for (let offset = 1; offset <= NEARBY_RADIUS_DAYS && nearby.length < NEARBY_COUNT; offset += 1) {
    for (const candidate of [addDaysIso(date, offset), addDaysIso(date, -offset)]) {
      if (nearby.length >= NEARBY_COUNT) break;
      if (candidate < todayIso || candidate < cache.windowStart || candidate > cache.windowEnd) continue;
      if (!busy.has(candidate) && !nearby.some((entry) => entry.date === candidate)) nearby.push({ date: candidate, status: "available" });
    }
  }
  return { ok: true, date, status, nearby };
}

async function enforceRateLimit(request: Request, env: AvailabilityApiEnv): Promise<void> {
  if (!env.AVAILABILITY_RATE_LIMITER) {
    if (env.ENVIRONMENT !== "development") throw new AvailabilityApiError(503, "availability_unavailable", "Availability checks are temporarily unavailable");
    return;
  }
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`availability:${address}`));
  const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const result = await env.AVAILABILITY_RATE_LIMITER.limit({ key });
  if (!result.success) throw new AvailabilityApiError(429, "rate_limited", "Too many attempts. Please wait a minute and try again");
}

/**
 * GET /v1/availability?date=YYYY-MM-DD. Reads the KV busy-date cache and, when that cache is fresh and
 * the requested date is in-window, the D1 `events` table for capacity-blocking days (via
 * `listBlockingWindows`) — the only backend touch on the request path. Never calls Google on the
 * request path; returns no event data, only date/status.
 */
export async function handleAvailability(request: Request, env: AvailabilityApiEnv, now: Date = new Date()): Promise<Response> {
  await enforceRateLimit(request, env);
  const parsed = dateSchema.safeParse(new URL(request.url).searchParams.get("date"));
  if (!parsed.success) throw new AvailabilityApiError(422, "validation_error", "A valid date query parameter (YYYY-MM-DD) is required");

  const cache = await readAvailabilityCache(env.AVAILABILITY_CACHE);
  const staleMinutes = positiveInteger(env.AVAILABILITY_CACHE_STALE_MINUTES, 30);
  const fresh = cache && isFresh(cache, now, staleMinutes) ? cache : null;
  const todayIso = isoDateInTimeZone(now, fresh?.timeZone ?? "UTC");
  // Only touch D1 when the KV cache is fresh and the requested date is in-window — otherwise
  // resolveAvailability short-circuits to "unknown" and the blocked-date set is irrelevant.
  const blockedDates = fresh && env.DB && parsed.data >= fresh.windowStart && parsed.data <= fresh.windowEnd
    ? blockedDatesFromWindows(await listBlockingWindows(env.DB, fresh.windowStart, fresh.windowEnd))
    : new Set<string>();
  const body = resolveAvailability(fresh, parsed.data, todayIso, blockedDates);
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } });
}

export { AVAILABILITY_CACHE_KEY };

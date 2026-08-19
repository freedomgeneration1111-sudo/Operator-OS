const pad = (value: number) => String(value).padStart(2, "0");

function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - utcMs) / 60_000;
}

function zonedMidnightUtcMs(dateIso: string, timeZone: string): number {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const guessMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  return guessMs - offsetMinutesAt(guessMs, timeZone) * 60_000;
}

/** Day boundaries for `dateIso` (YYYY-MM-DD) as observed in `timeZone`, expressed as UTC instants. */
export function zonedDayBoundsUtc(dateIso: string, timeZone: string): { timeMinUtc: string; timeMaxUtc: string } {
  const startMs = zonedMidnightUtcMs(dateIso, timeZone);
  const endMs = zonedMidnightUtcMs(addDaysIso(dateIso, 1), timeZone);
  return { timeMinUtc: new Date(startMs).toISOString(), timeMaxUtc: new Date(endMs).toISOString() };
}

export function addDaysIso(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addMonthsIso(dateIso: string, months: number): string {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(year, month - 1 + months, day));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function isoDateInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isoDatesBetween(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  for (let cursor = startIso; cursor <= endIso; cursor = addDaysIso(cursor, 1)) dates.push(cursor);
  return dates;
}

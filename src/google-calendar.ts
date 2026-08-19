import { importPKCS8, SignJWT } from "jose";

export type GoogleServiceAccountKey = { client_email: string; private_key: string };
export type FreeBusyInterval = { start: string; end: string };

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freebusy";
const READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export function parseServiceAccountKey(raw: string): GoogleServiceAccountKey {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" || parsed === null
    || typeof (parsed as Record<string, unknown>).client_email !== "string"
    || typeof (parsed as Record<string, unknown>).private_key !== "string"
  ) {
    throw new Error("GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY is missing client_email or private_key");
  }
  return parsed as GoogleServiceAccountKey;
}

async function fetchAccessToken(serviceAccount: GoogleServiceAccountKey, fetcher: typeof fetch): Promise<string> {
  const key = await importPKCS8(serviceAccount.private_key, "RS256");
  const assertion = await new SignJWT({ scope: READONLY_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(serviceAccount.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed with status ${response.status}`);
  const body = await response.json<{ access_token?: string }>().catch(() => null);
  if (!body?.access_token) throw new Error("Google token exchange returned no access_token");
  return body.access_token;
}

/** Server-only. Queries `freebusy.query` — never `events.list` — for a single calendar. */
export async function queryFreeBusy(
  serviceAccount: GoogleServiceAccountKey,
  calendarId: string,
  timeMinUtc: string,
  timeMaxUtc: string,
  fetcher: typeof fetch = fetch,
): Promise<FreeBusyInterval[]> {
  const accessToken = await fetchAccessToken(serviceAccount, fetcher);
  const response = await fetcher(FREEBUSY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ timeMin: timeMinUtc, timeMax: timeMaxUtc, items: [{ id: calendarId }] }),
  });
  if (!response.ok) throw new Error(`Google freebusy query failed with status ${response.status}`);
  const body = await response.json<{ calendars?: Record<string, { busy?: FreeBusyInterval[]; errors?: unknown[] }> }>().catch(() => null);
  const calendar = body?.calendars?.[calendarId];
  if (!calendar || calendar.errors?.length) throw new Error("Google freebusy query returned a calendar error");
  return calendar.busy ?? [];
}

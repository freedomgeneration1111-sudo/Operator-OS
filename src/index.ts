import { z } from "zod";
import { bearerToken, secureTokenMatches } from "./auth";
import { inquiryRequestSchema, type ApiErrorResponse } from "./contracts";
import { handleCrm } from "./crm";
import { createConfiguredMessagingProvider, resolveChatStatus } from "./messaging";
import { createInquiry } from "./repository";

const heartbeatSchema = z.object({ responderId: z.string().trim().min(1).max(100), available: z.boolean() }).strict();
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_BODY_BYTES = 16_384;

function corsHeaders(request: Request, env: Env): Record<string,string> {
  const origin = request.headers.get("Origin");
  const allowed = env.PUBLIC_SITE_ORIGIN?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  return origin && allowed.includes(origin) ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  } : {};
}

function json(data: object, status = 200, headers: HeadersInit = {}) {
  return Response.json(data,{ status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function parseBoundedJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new PublicError(413,"payload_too_large","Request body is too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new PublicError(413,"payload_too_large","Request body is too large");
  try { return JSON.parse(text) as unknown; }
  catch { throw new PublicError(400,"invalid_json","Request body must be valid JSON"); }
}

class PublicError extends Error {
  constructor(readonly status: number,readonly code: string,message: string,readonly fields?: Record<string,string[]>) { super(message); }
}

async function publicInquiry(request: Request, env: Env) {
  const key = request.headers.get("Idempotency-Key");
  if (!key || !IDEMPOTENCY_PATTERN.test(key)) throw new PublicError(400,"invalid_idempotency_key","A valid Idempotency-Key header is required");
  const parsed = inquiryRequestSchema.safeParse(await parseBoundedJson(request));
  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    throw new PublicError(422,"validation_error","Request validation failed",flattened.fieldErrors as Record<string,string[]>);
  }
  const result = await createInquiry(env.DB,parsed.data,key,new Date().toISOString());
  return json(result,result.idempotentReplay ? 200 : 201);
}

async function heartbeat(request: Request, env: Env) {
  if (!await secureTokenMatches(bearerToken(request),env.INTERNAL_API_TOKEN)) {
    return json({ ok: false,error: { code: "unauthorized",message: "Authentication required" } },401,{ "WWW-Authenticate": "Bearer" });
  }
  const parsed = heartbeatSchema.safeParse(await parseBoundedJson(request));
  if (!parsed.success) throw new PublicError(422,"validation_error","Request validation failed",parsed.error.flatten().fieldErrors as Record<string,string[]>);
  const responder = await env.DB.prepare("SELECT id FROM responders WHERE id=? AND active=1").bind(parsed.data.responderId).first();
  if (!responder) throw new PublicError(404,"responder_not_found","Active responder not found");
  const nowDate = new Date();
  const timeoutSeconds = positiveInteger(env.PRESENCE_TIMEOUT_SECONDS,120);
  const expiresAt = new Date(nowDate.getTime()+timeoutSeconds*1000).toISOString();
  await env.DB.prepare(`INSERT INTO responder_presence (responder_id,available,heartbeat_at,expires_at,updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(responder_id) DO UPDATE SET available=excluded.available,
    heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
    .bind(parsed.data.responderId,parsed.data.available ? 1 : 0,nowDate.toISOString(),expiresAt,nowDate.toISOString()).run();
  return json({ ok: true,state: parsed.data.available ? "available" : "unavailable",expiresAt });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") return json({ ok: true,service: "focus-lab-operations" });
  if (request.method === "POST" && url.pathname === "/v1/inquiries") return publicInquiry(request,env);
  if (request.method === "GET" && url.pathname === "/v1/chat/status") {
    const provider = createConfiguredMessagingProvider(env.MESSAGING_PROVIDER,env.MESSAGING_DESTINATION_URL);
    return Response.json(await resolveChatStatus(env.DB,provider,new Date().toISOString()),{
      headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" },
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/internal/presence/heartbeat") return heartbeat(request,env);
  if (url.pathname.startsWith("/v1/internal/")) {
    if (!await secureTokenMatches(bearerToken(request),env.INTERNAL_API_TOKEN)) {
      return json({ ok: false,error: { code: "unauthorized",message: "Authentication required" } },401,{ "WWW-Authenticate": "Bearer" });
    }
    return handleCrm(request,env.DB,url.pathname,positiveInteger(env.CONCURRENT_EVENT_CAPACITY,1));
  }
  return json({ ok: false,error: { code: "not_found",message: "Route not found" } },404);
}

function positiveInteger(value: string | undefined,fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default {
  async fetch(request,env): Promise<Response> {
    const cors = corsHeaders(request,env);
    if (request.method === "OPTIONS") return new Response(null,{ status: 204,headers: cors });
    try {
      const response = await route(request,env);
      const headers = new Headers(response.headers);
      for (const [key,value] of Object.entries(cors)) headers.set(key,value);
      return new Response(response.body,{ status: response.status,statusText: response.statusText,headers });
    } catch (error) {
      if (error instanceof PublicError) {
        const body: ApiErrorResponse = { ok: false,error: { code: error.code,message: error.message,...(error.fields ? { fields: error.fields } : {}) } };
        return json(body,error.status,cors);
      }
      console.error(JSON.stringify({ message: "operations request failed",path: new URL(request.url).pathname,error: error instanceof Error ? error.message : "Unknown error" }));
      return json({ ok: false,error: { code: "internal_error",message: "The operation could not be completed" } },500,cors);
    }
  },
} satisfies ExportedHandler<Env>;

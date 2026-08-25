import { WHATSAPP_PROVIDER } from "./conversation-providers";
import { persistThroughRoom } from "./native-chat";

const GRAPH_API_VERSION = "v22.0";
const MEDIA_PLACEHOLDER_BODY = "[Media message received — reply not yet supported for this type]";

export class WhatsAppWebhookError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// --- Inbound: verify-token handshake (GET) -------------------------------

export function handleWhatsAppVerify(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || token !== env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || !challenge) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

// --- Inbound: message events (POST) ---------------------------------------

type WhatsAppInboundMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
};
type WhatsAppInboundContact = { wa_id: string; profile?: { name?: string } };
type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: WhatsAppInboundContact[];
        messages?: WhatsAppInboundMessage[];
      };
    }>;
  }>;
};

export async function handleWhatsAppWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  await enforceWhatsAppWebhookRateLimit(env);

  if (!env.WHATSAPP_APP_SECRET) {
    console.warn(JSON.stringify({ message: "whatsapp webhook skipped: not configured" }));
    throw new WhatsAppWebhookError(503, "WhatsApp is not configured for this deployment");
  }

  const rawBody = await request.text();
  if (!(await verifyWhatsAppSignature(env, request.headers.get("X-Hub-Signature-256"), rawBody))) {
    throw new WhatsAppWebhookError(401, "Invalid webhook signature");
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    // Malformed JSON from a request that passed signature verification shouldn't
    // trigger Meta retries — acknowledge and drop it.
    return new Response(null, { status: 200 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const contacts = change.value?.contacts ?? [];
      for (const message of change.value?.messages ?? []) {
        ctx.waitUntil(
          processInboundMessage(env, message, contacts.find((contact) => contact.wa_id === message.from)).catch((error) =>
            console.error(JSON.stringify({ message: "whatsapp inbound message processing failed", waMessageId: message.id, error: error instanceof Error ? error.message : "Unknown error" })),
          ),
        );
      }
    }
  }
  return new Response(null, { status: 200 });
}

async function processInboundMessage(env: Env, message: WhatsAppInboundMessage, contact: WhatsAppInboundContact | undefined) {
  const phone = normalizeWaId(message.from);
  const contactId = await findOrCreateContact(env.DB, phone, contact?.profile?.name ?? null);
  const conversationId = await findOrCreateConversation(env.DB, contactId, phone);
  const body = message.type === "text" && message.text?.body ? message.text.body.slice(0, 2000) : MEDIA_PLACEHOLDER_BODY;
  await persistThroughRoom(env, conversationId, { senderKind: "customer", senderResponderId: null, body, clientMessageId: message.id });
}

function normalizeWaId(waId: string) {
  const digits = waId.replace(/\D/g, "");
  return `+${digits}`;
}

async function findOrCreateContact(db: D1Database, phone: string, name: string | null): Promise<string> {
  const existing = await db.prepare("SELECT id FROM contacts WHERE phone=?").bind(phone).first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(`INSERT INTO contacts (id,full_name,email,phone,preferred_contact,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(id, name?.trim() || "WhatsApp Contact", null, phone, "messaging", now, now)
    .run();
  return id;
}

async function findOrCreateConversation(db: D1Database, contactId: string, phone: string): Promise<string> {
  const existing = await db
    .prepare("SELECT id FROM conversations WHERE provider=? AND external_conversation_id=?")
    .bind(WHATSAPP_PROVIDER, phone)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(`INSERT INTO conversations (id,contact_id,provider,external_conversation_id,channel_state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(id, contactId, WHATSAPP_PROVIDER, phone, "open", now, now)
    .run();
  return id;
}

// --- Signature verification -------------------------------------------------

async function verifyWhatsAppSignature(env: Env, header: string | null, rawBody: string): Promise<boolean> {
  if (!env.WHATSAPP_APP_SECRET || !header?.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.WHATSAPP_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, provided);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

// --- Rate limiting -----------------------------------------------------------

async function enforceWhatsAppWebhookRateLimit(env: Env) {
  if (!env.WHATSAPP_WEBHOOK_RATE_LIMITER) {
    if (env.ENVIRONMENT !== "development") throw new WhatsAppWebhookError(503, "WhatsApp webhook is temporarily unavailable");
    return;
  }
  const result = await env.WHATSAPP_WEBHOOK_RATE_LIMITER.limit({ key: "whatsapp-webhook" });
  if (!result.success) throw new WhatsAppWebhookError(429, "Too many requests");
}

// --- Outbound: staff reply -> WhatsApp Graph API ----------------------------

export type WhatsAppReplyResult = { providerMessageId: string };
export interface WhatsAppNotificationProvider {
  readonly name: string;
  sendWhatsAppReply(message: { to: string; body: string }): Promise<WhatsAppReplyResult>;
}

export class WhatsAppConfigurationError extends Error {}
export class WhatsAppDeliveryError extends Error {
  constructor(readonly category: string, message: string) {
    super(message);
  }
}

export function createWhatsAppNotificationProvider(env: Env, fetcher: typeof fetch = fetch): WhatsAppNotificationProvider {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) throw new WhatsAppConfigurationError("WhatsApp send is not configured");
  return new GraphApiWhatsAppNotificationProvider(env.WHATSAPP_ACCESS_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID, fetcher);
}

class GraphApiWhatsAppNotificationProvider implements WhatsAppNotificationProvider {
  readonly name = "whatsapp";
  constructor(private readonly accessToken: string, private readonly phoneNumberId: string, private readonly fetcher: typeof fetch) {}
  async sendWhatsAppReply(message: { to: string; body: string }): Promise<WhatsAppReplyResult> {
    const response = await this.fetcher(`https://graph.facebook.com/${GRAPH_API_VERSION}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: message.to, type: "text", text: { body: message.body } }),
    });
    const body = (await response.json().catch(() => null)) as { messages?: Array<{ id?: unknown }> } | null;
    const providerMessageId = body?.messages?.[0]?.id;
    if (!response.ok || typeof providerMessageId !== "string") {
      const category = response.status === 429 ? "rate_limited" : response.status >= 500 ? "provider_unavailable" : "provider_rejected";
      throw new WhatsAppDeliveryError(category, `WhatsApp Graph API rejected the message (${response.status})`);
    }
    return { providerMessageId };
  }
}

export type WhatsAppDispatchResult = { status: "whatsapp_accepted" | "whatsapp_failed"; notificationId: string };

// Dispatched from ChatRoom's persist() when a responder replies to a provider='whatsapp'
// conversation — this is the primary delivery path for that conversation (there's no
// "customer is live on the website socket" concept for WhatsApp), mirroring the
// conversation_notifications bookkeeping customer-continuity.ts uses for email.
export async function dispatchWhatsAppReply(
  env: Env,
  conversationId: string,
  message: { id: string; sequence: number; body: string },
  provider?: WhatsAppNotificationProvider,
): Promise<WhatsAppDispatchResult> {
  const notificationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const conversation = await env.DB.prepare("SELECT external_conversation_id FROM conversations WHERE id=?").bind(conversationId).first<{ external_conversation_id: string | null }>();
  const to = conversation?.external_conversation_id;
  if (!to) {
    await env.DB
      .prepare(`INSERT INTO conversation_notifications (id,conversation_id,message_id,message_sequence,provider,status,failure_code,attempted_at,completed_at) VALUES (?,?,?,?,'whatsapp','failed','missing_destination',?,?)`)
      .bind(notificationId, conversationId, message.id, message.sequence, now, now)
      .run();
    return { status: "whatsapp_failed", notificationId };
  }
  await env.DB
    .prepare(`INSERT INTO conversation_notifications (id,conversation_id,message_id,message_sequence,provider,status,attempted_at) VALUES (?,?,?,?,'whatsapp','pending',?)`)
    .bind(notificationId, conversationId, message.id, message.sequence, now)
    .run();
  let selectedProvider = provider;
  try {
    selectedProvider ??= createWhatsAppNotificationProvider(env);
    const result = await selectedProvider.sendWhatsAppReply({ to, body: message.body });
    const completed = new Date().toISOString();
    await env.DB.prepare("UPDATE conversation_notifications SET status='accepted',provider_message_id=?,completed_at=? WHERE id=?").bind(result.providerMessageId, completed, notificationId).run();
    return { status: "whatsapp_accepted", notificationId };
  } catch (error) {
    const failureCode = error instanceof WhatsAppConfigurationError ? "provider_not_configured" : error instanceof WhatsAppDeliveryError ? error.category : "delivery_error";
    const completed = new Date().toISOString();
    await env.DB.prepare("UPDATE conversation_notifications SET status='failed',failure_code=?,completed_at=? WHERE id=?").bind(failureCode, completed, notificationId).run();
    console.warn(JSON.stringify({ message: "whatsapp reply dispatch failed", conversationId, notificationId, failureCode }));
    return { status: "whatsapp_failed", notificationId };
  }
}

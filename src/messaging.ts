import type { ChatStatusResponse } from "./contracts";

export type MessagingProvider = {
  id: string;
  resolveDestination(): string | null;
  buildDestinationUrl(prefilledText?: string): string | null;
};

export function createConfiguredMessagingProvider(provider: string | undefined, destination: string | undefined): MessagingProvider | null {
  if (!provider || !destination) return null;
  let parsed: URL;
  try { parsed = new URL(destination); } catch { return null; }
  if (parsed.protocol !== "https:") return null;
  return {
    id: provider,
    resolveDestination: () => parsed.toString(),
    buildDestinationUrl: (text) => {
      const url = new URL(parsed);
      if (text) url.searchParams.set("text", text);
      return url.toString();
    },
  };
}

export async function resolveChatStatus(db: D1Database, provider: MessagingProvider | null, now: string, prompt="Hello, I would like to get in touch."): Promise<ChatStatusResponse> {
  if (!provider?.resolveDestination()) return { state: "unavailable", label: "Messaging unavailable", destinationUrl: null, checkedAt: now };
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM responder_presence presence
    JOIN responders responder ON responder.id=presence.responder_id
    WHERE responder.active=1 AND presence.available=1 AND presence.expires_at>?`).bind(now).first<{ count: number }>();
  const live = Number(row?.count ?? 0) > 0;
  // Legacy status-dashboard label only (feeds GET /v1/internal/status's `messaging` field).
  // No customer ever sees "Send us a DM" — the real customer-facing async label is
  // "Send us a Message", set in native-chat.ts's nativeChatStatus().
  return {
    state: live ? "live" : "async", label: live ? "Live Chat" : "Send us a DM",
    destinationUrl: provider.buildDestinationUrl(prompt), checkedAt: now,
  };
}

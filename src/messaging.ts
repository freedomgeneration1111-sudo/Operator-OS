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

export async function resolveChatStatus(db: D1Database, provider: MessagingProvider | null, now: string): Promise<ChatStatusResponse> {
  if (!provider?.resolveDestination()) return { state: "unavailable", label: "Messaging unavailable", destinationUrl: null, checkedAt: now };
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM responder_presence presence
    JOIN responders responder ON responder.id=presence.responder_id
    WHERE responder.active=1 AND presence.available=1 AND presence.expires_at>?`).bind(now).first<{ count: number }>();
  const live = Number(row?.count ?? 0) > 0;
  return {
    state: live ? "live" : "async", label: live ? "Live Chat" : "Send us a DM",
    destinationUrl: provider.buildDestinationUrl("Hi Focus Lab, I would like to discuss an event."), checkedAt: now,
  };
}

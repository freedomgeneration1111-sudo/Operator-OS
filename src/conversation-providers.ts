// `conversations.provider` has no DB-level CHECK constraint (ADR-0003 Decision 1 —
// a CHECK would require a SQLite table rebuild). This is the application-level
// enforcement of the allowed value set instead.
export const CONVERSATION_PROVIDERS = ["native_web", "whatsapp"] as const;
export type ConversationProvider = (typeof CONVERSATION_PROVIDERS)[number];
export const NATIVE_WEB_PROVIDER: ConversationProvider = "native_web";
export const WHATSAPP_PROVIDER: ConversationProvider = "whatsapp";

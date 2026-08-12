PRAGMA foreign_keys = ON;

CREATE TABLE conversation_resume_tokens (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('email_continuity')),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX conversation_resume_tokens_conversation_idx
  ON conversation_resume_tokens(conversation_id,revoked_at,created_at DESC);

CREATE TABLE conversation_notifications (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  message_sequence INTEGER NOT NULL,
  resume_token_id TEXT REFERENCES conversation_resume_tokens(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','failed')),
  provider_message_id TEXT,
  failure_code TEXT,
  attempted_at TEXT NOT NULL,
  completed_at TEXT,
  cleared_at TEXT,
  UNIQUE (conversation_id,message_sequence)
);
CREATE INDEX conversation_notifications_pending_idx
  ON conversation_notifications(conversation_id,cleared_at,status,attempted_at DESC);

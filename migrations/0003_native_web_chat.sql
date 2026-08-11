PRAGMA foreign_keys = ON;

ALTER TABLE conversations ADD COLUMN assigned_responder_id TEXT REFERENCES responders(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN public_resume_token_hash TEXT;
ALTER TABLE conversations ADD COLUMN last_message_at TEXT;
ALTER TABLE conversations ADD COLUMN last_customer_message_at TEXT;

CREATE UNIQUE INDEX conversations_resume_token_unique
  ON conversations(public_resume_token_hash) WHERE public_resume_token_hash IS NOT NULL;
CREATE INDEX conversations_native_updated_idx
  ON conversations(provider,channel_state,updated_at DESC);
CREATE INDEX conversations_assigned_idx
  ON conversations(assigned_responder_id,updated_at DESC);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  client_message_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('customer','responder','system')),
  sender_responder_id TEXT REFERENCES responders(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id,client_message_id),
  UNIQUE (conversation_id,sequence)
);
CREATE INDEX conversation_messages_history_idx
  ON conversation_messages(conversation_id,sequence);

CREATE TABLE conversation_reads (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  responder_id TEXT NOT NULL REFERENCES responders(id) ON DELETE CASCADE,
  last_read_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id,responder_id)
);

CREATE TABLE conversation_activity (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('system','customer','responder')),
  actor_id TEXT,
  activity_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX conversation_activity_history_idx
  ON conversation_activity(conversation_id,created_at DESC);

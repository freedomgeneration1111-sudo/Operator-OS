PRAGMA foreign_keys = ON;

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  responder_id TEXT NOT NULL REFERENCES responders(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  active_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_failure_code TEXT
);
CREATE INDEX push_subscriptions_responder_idx
  ON push_subscriptions(responder_id,enabled,updated_at DESC);
CREATE INDEX push_subscriptions_foreground_idx
  ON push_subscriptions(enabled,active_until);

CREATE TABLE push_deliveries (
  event_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','failed')),
  response_status INTEGER,
  attempted_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (event_id,subscription_id)
);
CREATE INDEX push_deliveries_subscription_idx
  ON push_deliveries(subscription_id,attempted_at DESC);

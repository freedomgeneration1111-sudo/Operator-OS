PRAGMA defer_foreign_keys = ON;

CREATE TABLE _s1_inquiries AS SELECT * FROM inquiries;
CREATE TABLE _s1_inquiry_services AS SELECT * FROM inquiry_services;
CREATE TABLE _s1_assignments AS SELECT * FROM assignments;
CREATE TABLE _s1_internal_notes AS SELECT * FROM internal_notes;
CREATE TABLE _s1_activities AS SELECT * FROM activities;
CREATE TABLE _s1_conversations AS SELECT * FROM conversations;
CREATE TABLE _s1_conversation_messages AS SELECT * FROM conversation_messages;
CREATE TABLE _s1_conversation_reads AS SELECT * FROM conversation_reads;
CREATE TABLE _s1_conversation_activity AS SELECT * FROM conversation_activity;
CREATE TABLE _s1_push_deliveries AS SELECT * FROM push_deliveries;
CREATE TABLE _s1_conversation_resume_tokens AS SELECT * FROM conversation_resume_tokens;
CREATE TABLE _s1_conversation_notifications AS SELECT * FROM conversation_notifications;

DROP TABLE conversation_notifications;
DROP TABLE conversation_resume_tokens;
DROP TABLE push_deliveries;
DROP TABLE conversation_activity;
DROP TABLE conversation_reads;
DROP TABLE conversation_messages;
DROP TABLE conversations;
DROP TABLE activities;
DROP TABLE internal_notes;
DROP TABLE assignments;
DROP TABLE inquiry_services;
DROP TABLE inquiries;

CREATE TABLE inquiries (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  event_id TEXT REFERENCES events(id) ON DELETE RESTRICT,
  source_channel TEXT NOT NULL,
  workflow_state TEXT NOT NULL DEFAULT 'new'
    CHECK (workflow_state IN ('new','reviewing','qualified','quoted','won','lost','archived')),
  budget_context TEXT, customer_note TEXT, idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX inquiries_created_idx ON inquiries(created_at DESC);
CREATE INDEX inquiries_state_created_idx ON inquiries(workflow_state,created_at DESC);
CREATE INDEX inquiries_contact_idx ON inquiries(contact_id);
CREATE INDEX inquiries_event_idx ON inquiries(event_id) WHERE event_id IS NOT NULL;

CREATE TABLE inquiry_services (
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  PRIMARY KEY (inquiry_id,service_name)
);

CREATE TABLE assignments (
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  responder_id TEXT NOT NULL REFERENCES responders(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL, assigned_by TEXT,
  PRIMARY KEY (inquiry_id,responder_id)
);
CREATE INDEX assignments_responder_idx ON assignments(responder_id,assigned_at DESC);

CREATE TABLE internal_notes (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  author_responder_id TEXT REFERENCES responders(id) ON DELETE SET NULL,
  body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX internal_notes_inquiry_idx ON internal_notes(inquiry_id,created_at DESC);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  inquiry_id TEXT REFERENCES inquiries(id) ON DELETE SET NULL,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  provider TEXT NOT NULL, external_conversation_id TEXT,
  channel_state TEXT NOT NULL DEFAULT 'open' CHECK (channel_state IN ('open','closed','pending')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  assigned_responder_id TEXT REFERENCES responders(id) ON DELETE SET NULL,
  public_resume_token_hash TEXT,
  last_message_at TEXT,
  last_customer_message_at TEXT
);
CREATE INDEX conversations_contact_idx ON conversations(contact_id,updated_at DESC);
CREATE INDEX conversations_inquiry_idx ON conversations(inquiry_id,updated_at DESC);
CREATE UNIQUE INDEX conversations_provider_external_unique ON conversations(provider,external_conversation_id) WHERE external_conversation_id IS NOT NULL;
CREATE UNIQUE INDEX conversations_resume_token_unique ON conversations(public_resume_token_hash) WHERE public_resume_token_hash IS NOT NULL;
CREATE INDEX conversations_native_updated_idx ON conversations(provider,channel_state,updated_at DESC);
CREATE INDEX conversations_assigned_idx ON conversations(assigned_responder_id,updated_at DESC);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT REFERENCES inquiries(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('system','customer','responder')),
  actor_id TEXT, activity_type TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX activities_inquiry_idx ON activities(inquiry_id,created_at DESC);
CREATE INDEX activities_event_idx ON activities(event_id,created_at DESC);

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
CREATE INDEX conversation_messages_history_idx ON conversation_messages(conversation_id,sequence);

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
CREATE INDEX conversation_activity_history_idx ON conversation_activity(conversation_id,created_at DESC);

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
CREATE INDEX push_deliveries_subscription_idx ON push_deliveries(subscription_id,attempted_at DESC);

CREATE TABLE conversation_resume_tokens (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('email_continuity')),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX conversation_resume_tokens_conversation_idx ON conversation_resume_tokens(conversation_id,revoked_at,created_at DESC);

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
CREATE INDEX conversation_notifications_pending_idx ON conversation_notifications(conversation_id,cleared_at,status,attempted_at DESC);

INSERT INTO inquiries SELECT * FROM _s1_inquiries;
INSERT INTO inquiry_services SELECT * FROM _s1_inquiry_services;
INSERT INTO assignments SELECT * FROM _s1_assignments;
INSERT INTO internal_notes SELECT * FROM _s1_internal_notes;
INSERT INTO activities SELECT * FROM _s1_activities;
INSERT INTO conversations SELECT * FROM _s1_conversations;
INSERT INTO conversation_messages SELECT * FROM _s1_conversation_messages;
INSERT INTO conversation_reads SELECT * FROM _s1_conversation_reads;
INSERT INTO conversation_activity SELECT * FROM _s1_conversation_activity;
INSERT INTO push_deliveries SELECT * FROM _s1_push_deliveries;
INSERT INTO conversation_resume_tokens SELECT * FROM _s1_conversation_resume_tokens;
INSERT INTO conversation_notifications SELECT * FROM _s1_conversation_notifications;

DROP TABLE _s1_conversation_notifications;
DROP TABLE _s1_conversation_resume_tokens;
DROP TABLE _s1_push_deliveries;
DROP TABLE _s1_conversation_activity;
DROP TABLE _s1_conversation_reads;
DROP TABLE _s1_conversation_messages;
DROP TABLE _s1_conversations;
DROP TABLE _s1_activities;
DROP TABLE _s1_internal_notes;
DROP TABLE _s1_assignments;
DROP TABLE _s1_inquiry_services;
DROP TABLE _s1_inquiries;

CREATE TABLE consulting_details (
  inquiry_id TEXT PRIMARY KEY REFERENCES inquiries(id) ON DELETE CASCADE,
  organization TEXT,
  offer_service_area TEXT,
  situation_problem TEXT,
  desired_outcome TEXT,
  timeline TEXT,
  budget TEXT,
  country_region TEXT,
  referral_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX consulting_details_organization_idx ON consulting_details(organization);
CREATE INDEX consulting_details_service_area_idx ON consulting_details(offer_service_area);

CREATE TABLE intake_submissions (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  form_schema_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  origin TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  referral TEXT,
  landing_page TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND length(payload_json) <= 16384)
);
CREATE INDEX intake_submissions_inquiry_idx ON intake_submissions(inquiry_id,received_at DESC);
CREATE INDEX intake_submissions_source_idx ON intake_submissions(source_channel,captured_at DESC);
CREATE INDEX intake_submissions_campaign_idx ON intake_submissions(utm_campaign,captured_at DESC) WHERE utm_campaign IS NOT NULL;

PRAGMA foreign_key_check;
PRAGMA defer_foreign_keys = OFF;

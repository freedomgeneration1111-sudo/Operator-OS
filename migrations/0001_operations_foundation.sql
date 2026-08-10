PRAGMA foreign_keys = ON;

CREATE TABLE contacts (
  id TEXT PRIMARY KEY, full_name TEXT NOT NULL, email TEXT, phone TEXT,
  preferred_contact TEXT CHECK (preferred_contact IN ('email','phone','messaging') OR preferred_contact IS NULL),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX contacts_email_unique ON contacts(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX contacts_phone_idx ON contacts(phone) WHERE phone IS NOT NULL;

CREATE TABLE events (
  id TEXT PRIMARY KEY, event_family TEXT, start_date TEXT, end_date TEXT,
  start_time TEXT, end_time TEXT, venue_location TEXT,
  guest_count INTEGER CHECK (guest_count IS NULL OR guest_count > 0),
  blocks_capacity INTEGER NOT NULL DEFAULT 0 CHECK (blocks_capacity IN (0,1)),
  scheduling_state TEXT NOT NULL DEFAULT 'requested'
    CHECK (scheduling_state IN ('requested','tentative','confirmed','cancelled','declined')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK ((start_time IS NULL AND end_time IS NULL) OR start_date IS NOT NULL)
);
CREATE INDEX events_date_range_idx ON events(start_date,end_date);
CREATE INDEX events_capacity_range_idx ON events(blocks_capacity,scheduling_state,start_date,end_date);

CREATE TABLE inquiries (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  source_channel TEXT NOT NULL,
  workflow_state TEXT NOT NULL DEFAULT 'new'
    CHECK (workflow_state IN ('new','reviewing','qualified','quoted','won','lost','archived')),
  budget_context TEXT, customer_note TEXT, idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX inquiries_created_idx ON inquiries(created_at DESC);
CREATE INDEX inquiries_state_created_idx ON inquiries(workflow_state,created_at DESC);
CREATE INDEX inquiries_contact_idx ON inquiries(contact_id);
CREATE INDEX inquiries_event_idx ON inquiries(event_id);

CREATE TABLE inquiry_services (
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  PRIMARY KEY (inquiry_id,service_name)
);

CREATE TABLE responders (
  id TEXT PRIMARY KEY, display_label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX conversations_contact_idx ON conversations(contact_id,updated_at DESC);
CREATE INDEX conversations_inquiry_idx ON conversations(inquiry_id,updated_at DESC);
CREATE UNIQUE INDEX conversations_provider_external_unique
  ON conversations(provider,external_conversation_id) WHERE external_conversation_id IS NOT NULL;

CREATE TABLE responder_presence (
  responder_id TEXT PRIMARY KEY REFERENCES responders(id) ON DELETE CASCADE,
  available INTEGER NOT NULL CHECK (available IN (0,1)),
  heartbeat_at TEXT NOT NULL, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX responder_presence_expiry_idx ON responder_presence(available,expires_at);

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

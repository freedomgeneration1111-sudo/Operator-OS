PRAGMA foreign_keys = ON;

CREATE TABLE cms_documents (
  document_key TEXT PRIMARY KEY CHECK (document_key IN ('pricing','faqs')),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  current_revision_id TEXT NOT NULL,
  current_sequence INTEGER NOT NULL CHECK (current_sequence > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE cms_revisions (
  revision_id TEXT PRIMARY KEY,
  document_key TEXT NOT NULL CHECK (document_key IN ('pricing','faqs')),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  content_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  restored_from_revision_id TEXT,
  UNIQUE (document_key,sequence)
);

CREATE INDEX cms_revisions_document_created_idx ON cms_revisions(document_key,created_at DESC);

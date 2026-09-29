PRAGMA foreign_keys = ON;

CREATE TABLE cms_releases (
  release_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('publish','rollback')),
  status TEXT NOT NULL CHECK (status IN ('queued','building','deploying','live','failed')),
  active_slot INTEGER UNIQUE CHECK (active_slot IS NULL OR active_slot = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  snapshot_json TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  pricing_revision_id TEXT NOT NULL,
  faq_revision_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  hook_triggered_at TEXT,
  runner_build_id TEXT,
  source_git_sha TEXT,
  worker_version_id TEXT,
  deployment_urls_json TEXT,
  deployment_target_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  failure_code TEXT,
  failure_message TEXT,
  rollback_source_release_id TEXT,
  rollback_source_version_id TEXT,
  FOREIGN KEY (pricing_revision_id) REFERENCES cms_revisions(revision_id),
  FOREIGN KEY (faq_revision_id) REFERENCES cms_revisions(revision_id),
  FOREIGN KEY (rollback_source_release_id) REFERENCES cms_releases(release_id)
);

CREATE INDEX cms_releases_requested_idx ON cms_releases(requested_at DESC);
CREATE INDEX cms_releases_runner_build_idx ON cms_releases(runner_build_id);

CREATE TABLE cms_publication_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  current_live_release_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (current_live_release_id) REFERENCES cms_releases(release_id)
);

INSERT INTO cms_publication_state (singleton,current_live_release_id,updated_at)
VALUES (1,NULL,CURRENT_TIMESTAMP);

PRAGMA foreign_keys = ON;

ALTER TABLE cms_releases ADD COLUMN externally_superseded_at TEXT;
ALTER TABLE cms_releases ADD COLUMN external_supersession_reason TEXT;
ALTER TABLE cms_releases ADD COLUMN externally_active_worker_version_id TEXT;
ALTER TABLE cms_releases ADD COLUMN external_supersession_actor_id TEXT;
ALTER TABLE cms_releases ADD COLUMN external_supersession_actor_display_name TEXT;

CREATE TRIGGER cms_release_external_supersession_clears_live
AFTER UPDATE OF externally_superseded_at ON cms_releases
WHEN OLD.externally_superseded_at IS NULL AND NEW.externally_superseded_at IS NOT NULL
BEGIN
  UPDATE cms_publication_state
  SET current_live_release_id = NULL, updated_at = NEW.externally_superseded_at
  WHERE singleton = 1 AND current_live_release_id = NEW.release_id;
END;

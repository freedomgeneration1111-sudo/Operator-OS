PRAGMA foreign_keys = ON;

ALTER TABLE responders ADD COLUMN access_subject TEXT;
ALTER TABLE responders ADD COLUMN verified_email TEXT;
ALTER TABLE responders ADD COLUMN role TEXT NOT NULL DEFAULT 'responder'
  CHECK (role IN ('admin','manager','responder'));

CREATE UNIQUE INDEX responders_access_subject_unique
  ON responders(access_subject) WHERE access_subject IS NOT NULL;
CREATE UNIQUE INDEX responders_verified_email_unique
  ON responders(lower(verified_email)) WHERE verified_email IS NOT NULL;
CREATE INDEX responders_role_active_idx ON responders(role,active);

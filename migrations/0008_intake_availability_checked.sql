PRAGMA foreign_keys = ON;

ALTER TABLE intake_submissions
  ADD COLUMN availability_checked INTEGER CHECK (availability_checked IN (0,1));

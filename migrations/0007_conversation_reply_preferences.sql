PRAGMA foreign_keys = ON;

ALTER TABLE conversations ADD COLUMN reply_email INTEGER NOT NULL DEFAULT 1 CHECK (reply_email IN (0,1));
ALTER TABLE conversations ADD COLUMN reply_sms   INTEGER NOT NULL DEFAULT 0 CHECK (reply_sms IN (0,1));
ALTER TABLE conversations ADD COLUMN reply_call  INTEGER NOT NULL DEFAULT 0 CHECK (reply_call IN (0,1));

ALTER TABLE agenda ADD COLUMN important INTEGER NOT NULL DEFAULT 0 CHECK(important IN (0,1));
ALTER TABLE agenda ADD COLUMN milestone TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda ADD COLUMN repeat TEXT NOT NULL DEFAULT 'none' CHECK(repeat IN ('none','daily','weekly'));
ALTER TABLE agenda ADD COLUMN repeat_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agenda ADD COLUMN repeat_until TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1));
CREATE TABLE agenda_occurrences (
 series_id TEXT NOT NULL REFERENCES agenda(id), day TEXT NOT NULL,
 done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)), deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, PRIMARY KEY(series_id,day)
) STRICT;
CREATE TABLE planner_receipts(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response TEXT NOT NULL) STRICT;
CREATE INDEX agenda_pinned ON agenda(important,done,deleted_at,deadline,day);
PRAGMA user_version=10;

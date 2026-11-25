CREATE TABLE paper_jobs (
 paper_id TEXT NOT NULL REFERENCES papers(id),
 stage TEXT NOT NULL CHECK(stage IN ('parse','translate')),
 state TEXT NOT NULL CHECK(state IN ('queued','running','paused','failed','done')),
 done INTEGER NOT NULL DEFAULT 0 CHECK(done>=0),
 total INTEGER NOT NULL DEFAULT 0 CHECK(total>=0),
 message TEXT NOT NULL DEFAULT '',
 payload TEXT NOT NULL DEFAULT '{}',
 token TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(paper_id,stage)
) STRICT;
CREATE TABLE codex_connection (
 id INTEGER PRIMARY KEY CHECK(id=1),
 path TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1
) STRICT;
PRAGMA user_version=12;
CREATE TABLE research_sources (
 task_id TEXT PRIMARY KEY REFERENCES agenda(id), paper_id TEXT NOT NULL REFERENCES papers(id),
 page INTEGER NOT NULL CHECK(page>0), mark_id TEXT NOT NULL DEFAULT '', mark_revision INTEGER NOT NULL DEFAULT 0,
 quote TEXT NOT NULL, rects TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE focus_sessions (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES agenda(id), task_revision INTEGER NOT NULL,
 title TEXT NOT NULL, planned_seconds INTEGER NOT NULL CHECK(planned_seconds BETWEEN 60 AND 10800),
 elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK(elapsed_seconds>=0),
 state TEXT NOT NULL CHECK(state IN ('running','paused','review','interrupted','finished')),
 running_since TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 result TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE UNIQUE INDEX focus_one_active ON focus_sessions((1)) WHERE state!='finished';
CREATE TABLE focus_receipts (
 request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL
) STRICT;
PRAGMA user_version=9;

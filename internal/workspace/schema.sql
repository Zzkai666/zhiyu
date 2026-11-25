PRAGMA application_id = 1380208210;
CREATE TABLE papers (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, authors TEXT NOT NULL DEFAULT '',
    year INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '待阅读' CHECK(status IN ('待阅读','阅读中','已读')),
    favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)), tags TEXT NOT NULL DEFAULT '[]',
    doi TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes > 0),
    revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
) STRICT;
CREATE TABLE positions (
    paper_id TEXT PRIMARY KEY REFERENCES papers(id), page INTEGER NOT NULL CHECK(page > 0),
    zoom INTEGER NOT NULL CHECK(zoom BETWEEN 50 AND 250), updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE marks (
    id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id), page INTEGER NOT NULL CHECK(page > 0),
    kind TEXT NOT NULL CHECK(kind IN ('bookmark','highlight','underline')),
    color TEXT NOT NULL CHECK(color IN ('amber','green','blue','pink')), quote TEXT NOT NULL DEFAULT '',
    rects TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX marks_bookmark ON marks(paper_id,page) WHERE kind='bookmark';
CREATE TABLE notes (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, paper_id TEXT REFERENCES papers(id),
    page INTEGER NOT NULL DEFAULT 0, quote TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
) STRICT;
CREATE TABLE note_history (
    note_id TEXT NOT NULL REFERENCES notes(id), revision INTEGER NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(note_id,revision)
) STRICT;
CREATE TABLE words (
    id TEXT PRIMARY KEY, term TEXT NOT NULL, meaning TEXT NOT NULL, paper_id TEXT REFERENCES papers(id),
    page INTEGER NOT NULL DEFAULT 0, quote TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL,
    interval_days INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE page_parses (
    paper_id TEXT NOT NULL REFERENCES papers(id), page INTEGER NOT NULL CHECK(page > 0),
    engine TEXT NOT NULL CHECK(engine IN ('native','layout-v2')), blocks TEXT NOT NULL, created_at TEXT NOT NULL,
    revision INTEGER NOT NULL, PRIMARY KEY(paper_id,page,engine,revision)
) STRICT;
PRAGMA user_version = 1;

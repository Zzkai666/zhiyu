CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','done','archived')),
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE agenda (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('task','event')),
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    day TEXT NOT NULL DEFAULT '',
    start TEXT NOT NULL DEFAULT '',
    end TEXT NOT NULL DEFAULT '',
    deadline TEXT NOT NULL DEFAULT '',
    project_id TEXT REFERENCES projects(id),
    paper_id TEXT REFERENCES papers(id),
    paper_page INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)),
    revision INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX agenda_days ON agenda(day,deleted_at);
PRAGMA user_version=2;

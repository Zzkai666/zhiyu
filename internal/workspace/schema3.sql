CREATE TABLE courses (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), revision INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE chapters (
    id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), title TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','reading','done')),
    paper_id TEXT REFERENCES papers(id), paper_page INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE study_records (
    id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id), day TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK(minutes BETWEEN 0 AND 1440), detail TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE experiments (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, question TEXT NOT NULL, project_id TEXT REFERENCES projects(id),
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), revision INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE runs (
    id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id), title TEXT NOT NULL, day TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('finished','failed','incomplete')),
    condition TEXT NOT NULL, metrics TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE life_entries (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('water','habit','cardio','strength')),
    title TEXT NOT NULL, day TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity >= 0), minutes INTEGER NOT NULL CHECK(minutes BETWEEN 0 AND 1440),
    detail TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)), revision INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE UNIQUE INDEX water_one_day ON life_entries(day) WHERE kind='water';
PRAGMA user_version=3;

CREATE TABLE reading_pages (
 paper_id TEXT NOT NULL REFERENCES papers(id), page INTEGER NOT NULL CHECK(page>0), blocks TEXT NOT NULL,
 PRIMARY KEY(paper_id,page)
) STRICT;
CREATE TABLE reading_edits (
 paper_id TEXT PRIMARY KEY REFERENCES papers(id), revision INTEGER NOT NULL, edits TEXT NOT NULL
) STRICT;
CREATE TABLE reading_translations (
 paper_id TEXT NOT NULL REFERENCES papers(id), fingerprint TEXT NOT NULL, text TEXT NOT NULL, model TEXT NOT NULL,
 effort TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(paper_id,fingerprint)
) STRICT;
PRAGMA user_version=4;

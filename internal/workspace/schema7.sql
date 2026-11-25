ALTER TABLE marks RENAME TO marks_before7;
CREATE TABLE marks (
 id TEXT PRIMARY KEY,paper_id TEXT NOT NULL REFERENCES papers(id),page INTEGER NOT NULL CHECK(page>0),
 kind TEXT NOT NULL CHECK(kind IN ('bookmark','highlight','underline','note','text','area','ink')),
 color TEXT NOT NULL CHECK(color IN ('amber','red','green','blue','purple','pink','orange','gray')),
 quote TEXT NOT NULL DEFAULT '',rects TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,
 comment TEXT NOT NULL DEFAULT '',points TEXT NOT NULL DEFAULT '[]',
 size REAL NOT NULL DEFAULT 14 CHECK(size BETWEEN 8 AND 48),width REAL NOT NULL DEFAULT 2 CHECK(width BETWEEN 1 AND 12),
 revision INTEGER NOT NULL DEFAULT 1
) STRICT;
INSERT INTO marks(id,paper_id,page,kind,color,quote,rects,created_at,comment)
 SELECT id,paper_id,page,kind,color,quote,rects,created_at,comment FROM marks_before7;
DROP TABLE marks_before7;
CREATE UNIQUE INDEX marks_bookmark ON marks(paper_id,page) WHERE kind='bookmark';
ALTER TABLE papers ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE papers ADD COLUMN filename TEXT NOT NULL DEFAULT '';
UPDATE papers SET filename=CASE WHEN revision=1 THEN title ELSE '' END;
CREATE TABLE sentence_alignments(
 paper_id TEXT NOT NULL REFERENCES papers(id),fingerprint TEXT NOT NULL,translation_hash TEXT NOT NULL,
 pairs TEXT NOT NULL,model TEXT NOT NULL,saved_at TEXT NOT NULL,
 PRIMARY KEY(paper_id,fingerprint,translation_hash)
) STRICT;
ALTER TABLE positions RENAME TO positions_before7;
CREATE TABLE positions(paper_id TEXT PRIMARY KEY REFERENCES papers(id),page INTEGER NOT NULL CHECK(page>0),zoom INTEGER NOT NULL CHECK(zoom BETWEEN 20 AND 400),updated_at TEXT NOT NULL) STRICT;
INSERT INTO positions SELECT * FROM positions_before7;
DROP TABLE positions_before7;
PRAGMA user_version=7;

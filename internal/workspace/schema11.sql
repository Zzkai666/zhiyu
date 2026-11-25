CREATE TABLE paper_extras (
 paper_id TEXT PRIMARY KEY REFERENCES papers(id),
 page_count INTEGER NOT NULL DEFAULT 0 CHECK(page_count BETWEEN 0 AND 100000),
 remark TEXT NOT NULL DEFAULT '',
 remark_revision INTEGER NOT NULL DEFAULT 0 CHECK(remark_revision>=0)
) STRICT;
UPDATE papers SET status='阅读中',revision=revision+1
 WHERE status='待阅读' AND EXISTS(SELECT 1 FROM positions WHERE paper_id=papers.id);
PRAGMA user_version=11;

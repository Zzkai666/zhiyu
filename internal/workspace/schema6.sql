ALTER TABLE projects ADD COLUMN area TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN deadline TEXT NOT NULL DEFAULT '';

CREATE TABLE goals (
 id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE goal_history (
 goal_id TEXT NOT NULL REFERENCES goals(id), revision INTEGER NOT NULL,
 snapshot TEXT NOT NULL, reason TEXT NOT NULL, saved_at TEXT NOT NULL,
 PRIMARY KEY(goal_id,revision)
) STRICT;
CREATE TABLE goal_projects (
 goal_id TEXT NOT NULL REFERENCES goals(id), project_id TEXT NOT NULL REFERENCES projects(id),
 PRIMARY KEY(goal_id,project_id)
) STRICT;
CREATE INDEX goal_projects_project ON goal_projects(project_id);
CREATE TABLE project_papers (
 project_id TEXT NOT NULL REFERENCES projects(id), target_id TEXT NOT NULL REFERENCES papers(id),
 PRIMARY KEY(project_id,target_id)
) STRICT;
CREATE TABLE project_notes (
 project_id TEXT NOT NULL REFERENCES projects(id), target_id TEXT NOT NULL REFERENCES notes(id),
 PRIMARY KEY(project_id,target_id)
) STRICT;
PRAGMA user_version=6;

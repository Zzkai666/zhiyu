package workspace

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestSchema6PreservesSchema5ProjectsAndTaskMembership(t *testing.T) {
	root := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(root, "researchdesk-next.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(schema + schema2 + schema3 + schema4 + schema5 + `
 INSERT INTO projects(id,title,description,status,updated_at,revision) VALUES('previous','旧项目','原说明','active','2026-11-11',8);
 INSERT INTO agenda(id,kind,title,detail,project_id,updated_at) VALUES('task','task','旧任务','','previous','2026-11-11');
 `); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	w, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	var project Project
	if err = w.db.QueryRow("SELECT id,title,description,status,area,deadline,revision FROM projects WHERE id='previous'").Scan(
		&project.ID, &project.Title, &project.Description, &project.Status, &project.Area, &project.Deadline, &project.Revision); err != nil ||
		project.Revision != 8 || project.Title != "旧项目" || project.Area != "" || project.Deadline != "" {
		t.Fatal(project, err)
	}
	task, err := scanAgenda(w.db.QueryRow(agendaSelect + " WHERE id='task'"))
	if err != nil || task.ProjectID != project.ID || task.Title != "旧任务" {
		t.Fatal(task, err)
	}
	files, err := filepath.Glob(filepath.Join(root, "pre-schema*-*.sqlite"))
	if err != nil || len(files) != 1 {
		t.Fatal(files, err)
	}
	before, err := sql.Open("sqlite", files[0])
	if err != nil {
		t.Fatal(err)
	}
	defer before.Close()
	var version int
	if err = before.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 5 {
		t.Fatal(version, err)
	}
}

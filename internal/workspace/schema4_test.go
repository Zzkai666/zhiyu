package workspace

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestSchema4BacksUpExistingWorkspace(t *testing.T) {
	root := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(root, "researchdesk-next.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(schema + schema2 + schema3); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO projects(id,title,description,status,updated_at) VALUES('fixture','Existing project','','active','2026-11-10')"); err != nil {
		db.Close()
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
	var title string
	if err = w.db.QueryRow("SELECT title FROM projects WHERE id='fixture'").Scan(&title); err != nil || title != "Existing project" {
		t.Fatal(title, err)
	}
	backups, err := filepath.Glob(filepath.Join(root, "pre-schema*-*.sqlite"))
	if err != nil || len(backups) != 1 {
		t.Fatal(backups, err)
	}
	before, err := sql.Open("sqlite", backups[0])
	if err != nil {
		t.Fatal(err)
	}
	defer before.Close()
	var version int
	if err = before.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 3 {
		t.Fatal(version, err)
	}
}

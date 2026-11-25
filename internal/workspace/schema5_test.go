package workspace

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestSchema5KeepsReaderCorrectionsAndExistingMarks(t *testing.T) {
	root := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(root, "researchdesk-next.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(schema + schema2 + schema3 + schema4 + `
INSERT INTO papers(id,title,added_at,bytes) VALUES('paper','Fixture','2026-11-10',1);
INSERT INTO reading_edits VALUES('paper',7,'{"joins":[{"from":"p1-b1","to":"p1-b2"}],"regions":{"p1-b3":{"kind":"author"}}}');
INSERT INTO marks(id,paper_id,page,kind,color,quote,rects,created_at)
VALUES('mark','paper',1,'highlight','amber','Existing text','[{"x":0.1,"y":0.1,"w":0.2,"h":0.02}]','2026-11-10');
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
	var version int
	if err = w.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != schemaVersion {
		t.Fatal(version, err)
	}
	_, edits, err := w.readReadingPlan(t.Context(), "paper")
	if err != nil || len(edits.Joins) != 1 || edits.Joins[0].To != "p1-b2" || edits.Regions["p1-b3"].Kind != "author" {
		t.Fatal(edits, err)
	}
	var quote, comment string
	if err = w.db.QueryRow("SELECT quote,comment FROM marks WHERE id='mark'").Scan(&quote, &comment); err != nil || quote != "Existing text" || comment != "" {
		t.Fatal(quote, comment, err)
	}
	files, err := filepath.Glob(filepath.Join(root, "pre-schema*-*.sqlite"))
	if err != nil || len(files) != 1 {
		t.Fatal(files, err)
	}
}

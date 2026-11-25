package workspace

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
)

func TestSchema7KeepsAllExistingMarksAndBacksUpBeforeMigration(t *testing.T) {
	root := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(root, "researchdesk-next.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(schema + schema2 + schema3 + schema4 + schema5 + schema6 + `
 INSERT INTO papers(id,title,bytes,added_at) VALUES('paper','Old paper',200,'yesterday');
 INSERT INTO marks(id,paper_id,page,kind,color,quote,rects,created_at,comment) VALUES('old','paper',1,'highlight','blue','original','[{"x":0.1,"y":0.2,"w":0.2,"h":0.1}]','before','a comment');
 INSERT INTO positions VALUES('paper',3,140,'before');
 `)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	w, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	var quote, comment, filename string
	var revision int
	if err = w.db.QueryRow("SELECT quote,comment,revision FROM marks WHERE id='old'").Scan(&quote, &comment, &revision); err != nil || quote != "original" || comment != "a comment" || revision != 1 {
		t.Fatal(quote, comment, err)
	}
	_ = w.db.QueryRow("SELECT filename FROM papers WHERE id='paper'").Scan(&filename)
	if filename != "Old paper" {
		t.Fatal(filename)
	}
	files, _ := filepath.Glob(filepath.Join(root, "pre-schema*-*.sqlite"))
	if len(files) != 1 {
		t.Fatal(files)
	}
	backup, _ := sql.Open("sqlite", files[0])
	defer backup.Close()
	var version int
	_ = backup.QueryRow("PRAGMA user_version").Scan(&version)
	if version != 6 {
		t.Fatal(version)
	}
}
func TestAnnotationKindsAndStaleEditProtection(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, h, "%PDF-1.7\nannotation")
	for _, kind := range []string{"note", "text", "area", "ink"} {
		mark := Mark{Page: 1, Kind: kind, Color: "purple", Comment: "content", Rects: []Rect{{.1, .1, .2, .2}}, Points: []Point{{.1, .1}, {.2, .2}}, Size: 14, Width: 3}
		response := sendJSON(t, h, http.MethodPost, "/papers/"+paper.ID+"/marks", mark, 201)
		var saved Mark
		_ = json.Unmarshal(*response, &saved)
		if saved.ID == "" || saved.Revision != 1 {
			t.Fatal(saved)
		}
		saved.Comment = "edited"
		sendJSON(t, h, http.MethodPut, "/papers/"+paper.ID+"/marks/"+saved.ID, saved, 200)
		sendJSON(t, h, http.MethodPut, "/papers/"+paper.ID+"/marks/"+saved.ID, saved, 409)
	}
}

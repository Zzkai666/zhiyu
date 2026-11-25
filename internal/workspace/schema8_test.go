package workspace

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
)

func TestSchema8SeparatesFreeTextFromCommentsWithoutLosingMarks(t *testing.T) {
	root := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(root, "researchdesk-next.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(schema + schema2 + schema3 + schema4 + schema5 + schema6 + schema7 + `
 INSERT INTO papers(id,title,bytes,added_at) VALUES('paper','Old paper',200,'yesterday');
 INSERT INTO marks(id,paper_id,page,kind,color,quote,rects,created_at,comment) VALUES('text','paper',1,'text','blue','','[{"x":0.1,"y":0.2,"w":0.2,"h":0.1}]','before','页面上的文字');
 INSERT INTO marks(id,paper_id,page,kind,color,quote,rects,created_at,comment) VALUES('note','paper',1,'note','amber','','[{"x":0.1,"y":0.2,"w":0.2,"h":0.1}]','before','笔记批注');
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
	var content, comment string
	if err = w.db.QueryRow("SELECT content,comment FROM marks WHERE id='text'").Scan(&content, &comment); err != nil || content != "页面上的文字" || comment != "" {
		t.Fatal(content, comment, err)
	}
	if err = w.db.QueryRow("SELECT content,comment FROM marks WHERE id='note'").Scan(&content, &comment); err != nil || content != "" || comment != "笔记批注" {
		t.Fatal(content, comment, err)
	}
	files, _ := filepath.Glob(filepath.Join(root, "pre-schema*-*.sqlite"))
	if len(files) != 1 {
		t.Fatal(files)
	}
	backup, _ := sql.Open("sqlite", files[0])
	defer backup.Close()
	var version int
	backup.QueryRow("PRAGMA user_version").Scan(&version)
	if version != 7 {
		t.Fatal(version)
	}
	var page int
	var zoom float64
	w.db.QueryRow("SELECT page,zoom FROM positions WHERE paper_id='paper'").Scan(&page, &zoom)
	if page != 3 || zoom != 140 {
		t.Fatal(page, zoom)
	}
}
func TestFreeTextContentAndCommentAreIndependentlyEditable(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, h, "%PDF-1.7\nannotation")
	raw := sendJSON(t, h, http.MethodPost, "/papers/"+paper.ID+"/marks", Mark{Page: 1, Kind: "text", Color: "blue", Content: "PDF 文字", Comment: "单独的评论", Rects: []Rect{{.1, .1, .2, .1}}}, 201)
	var mark Mark
	json.Unmarshal(*raw, &mark)
	mark.Comment = "修改评论"
	mark.Color = "pink"
	raw = sendJSON(t, h, http.MethodPut, "/papers/"+paper.ID+"/marks/"+mark.ID, mark, 200)
	json.Unmarshal(*raw, &mark)
	if mark.Content != "PDF 文字" || mark.Comment != "修改评论" || mark.Color != "pink" || mark.Revision != 2 {
		t.Fatal(mark)
	}
	sendJSON(t, h, http.MethodPut, "/papers/"+paper.ID+"/marks/"+mark.ID, Mark{ID: mark.ID, Page: 1, Kind: "text", Color: "blue", Content: "旧状态", Rects: mark.Rects, Size: 14, Width: 2, Revision: 1}, 409)
}

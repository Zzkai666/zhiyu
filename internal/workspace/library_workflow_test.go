package workspace

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
)

func TestReadingPositionAdvancesUnreadAndPreservesCompleted(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	p, _, code := importFixture(t, h, "%PDF-1.7\nlibrary workflow")
	if code != 201 {
		t.Fatal(code)
	}
	r := request(t, h, "PUT", "/papers/"+p.ID+"/position", `{"page":1,"zoom":100}`, nil)
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body)
	}
	var rows []Paper
	r = request(t, h, "GET", "/papers", "", nil)
	if err = json.Unmarshal(r.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	if rows[0].Status != "阅读中" {
		t.Fatalf("saved reading position but library still reports %q; expected 阅读中", rows[0].Status)
	}
	if rows[0].Revision != p.Revision+1 {
		t.Fatal("automatic status change must advance metadata revision")
	}
	p = rows[0]
	p.Status = "已读"
	sendJSON(t, h, "PATCH", "/papers/"+p.ID, map[string]any{"title": p.Title, "authors": p.Authors, "year": p.Year, "status": p.Status, "favorite": p.Favorite, "tags": p.Tags, "doi": p.DOI, "revision": p.Revision, "deleted": false}, http.StatusOK)
	r = request(t, h, "PUT", "/papers/"+p.ID+"/position", `{"page":2,"zoom":120}`, nil)
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body)
	}
	r = request(t, h, "GET", "/papers", "", nil)
	json.Unmarshal(r.Body.Bytes(), &rows)
	if rows[0].Status != "已读" {
		t.Fatal("reopening a completed paper reset status")
	}
}

func TestLibraryExtrasIndependentRevisionsAndDeletedProtection(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	p, _, _ := importFixture(t, h, "%PDF-1.7\nextras fixture")
	base := "/papers/" + p.ID
	for _, pages := range []int{0, 100001} {
		sendJSON(t, h, "PUT", base+"/preview-info", map[string]int{"pages": pages}, 400)
	}
	sendJSON(t, h, "PUT", base+"/preview-info", map[string]int{"pages": 38}, 200)
	sendJSON(t, h, "PUT", base+"/preview-info", map[string]int{"pages": 38}, 200)
	sendJSON(t, h, "PUT", base+"/preview-info", map[string]int{"pages": 39}, 409)
	sendJSON(t, h, "PATCH", base+"/remark", map[string]any{"remark": "第一条\n中文备注", "revision": 0}, 200)
	sendJSON(t, h, "PATCH", base+"/remark", map[string]any{"remark": "第一条\n中文备注", "revision": 0}, 200)
	sendJSON(t, h, "PATCH", base+"/remark", map[string]any{"remark": "另外窗口的旧输入", "revision": 0}, 409)
	sendJSON(t, h, "PUT", base+"/preview-info", map[string]int{"pages": 38}, 200)
	var rows []Paper
	r := request(t, h, "GET", "/papers", "", nil)
	json.Unmarshal(r.Body.Bytes(), &rows)
	got := rows[0]
	if got.Remark != "第一条\n中文备注" || got.RemarkRevision != 1 || got.Revision != p.Revision || got.TotalPages != 38 {
		t.Fatal(got)
	}
	r = request(t, h, "PUT", base+"/position", `{"page":39,"zoom":100}`, nil)
	if r.Code != 400 {
		t.Fatal(r.Code)
	}
	sendJSON(t, h, "PATCH", base, map[string]any{"title": p.Title, "authors": "", "year": 0, "status": "待阅读", "favorite": false, "tags": []string{}, "doi": "", "revision": got.Revision, "deleted": true}, 200)
	sendJSON(t, h, "PATCH", base+"/remark", map[string]any{"remark": "不能复活", "revision": 1}, 404)
	sendJSON(t, h, "PUT", base+"/preview-info", map[string]int{"pages": 38}, 404)
}
func TestSchema11BacksUpAndReconcilesOnlyUnreadPositions(t *testing.T) {
	root := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(root, "researchdesk-next.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range []string{schema, schema2, schema3, schema4, schema5, schema6, schema7, schema8, schema9, schema10} {
		if _, err = db.Exec(migration); err != nil {
			t.Fatal(err)
		}
	}
	_, err = db.Exec(`INSERT INTO papers(id,title,bytes,added_at,status) VALUES('unread','Old',100,'before','待阅读'),('done','Done',100,'before','已读'),('new','Untouched',100,'before','待阅读');INSERT INTO positions VALUES('unread',3,130,'before'),('done',4,120,'before')`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	w, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	for id, want := range map[string]string{"unread": "阅读中", "done": "已读", "new": "待阅读"} {
		var status string
		w.db.QueryRow("SELECT status FROM papers WHERE id=?", id).Scan(&status)
		if status != want {
			t.Fatal(id, status)
		}
	}
	var page, zoom int
	w.db.QueryRow("SELECT page,zoom FROM positions WHERE paper_id='unread'").Scan(&page, &zoom)
	if page != 3 || zoom != 130 {
		t.Fatal(page, zoom)
	}
	files, _ := filepath.Glob(filepath.Join(root, "pre-schema*-*.sqlite"))
	if len(files) != 1 {
		t.Fatal("missing schema10 backup", files)
	}
	before, _ := sql.Open("sqlite", files[0])
	defer before.Close()
	var version int
	before.QueryRow("PRAGMA user_version").Scan(&version)
	if version != 10 {
		t.Fatal(version)
	}
	var old string
	before.QueryRow("SELECT status FROM papers WHERE id='unread'").Scan(&old)
	if old != "待阅读" {
		t.Fatal("backup not original")
	}
}

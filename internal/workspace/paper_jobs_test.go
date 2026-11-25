package workspace

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func jobRequest(t *testing.T, h http.Handler, p, stage, body string, status int) PaperJob {
	t.Helper()
	r := request(t, h, "POST", "/papers/"+p+"/jobs/"+stage, body, nil)
	if r.Code != status {
		t.Fatalf("job status %d want %d: %s", r.Code, status, r.Body.String())
	}
	var j PaperJob
	if status == 200 {
		if e := json.Unmarshal(r.Body.Bytes(), &j); e != nil {
			t.Fatal(e)
		}
	}
	return j
}
func jobBody(v any) string { b, _ := json.Marshal(v); return string(b) }
func TestPaperJobsCheckpointPauseAndStaleToken(t *testing.T) {
	w, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	p, _, _ := importFixture(t, h, "%PDF-1.7 jobs")
	request(t, h, "PUT", "/papers/"+p.ID+"/preview-info", `{"pages":2}`, nil)
	r := request(t, h, "GET", "/paper-jobs", "", nil)
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	j := jobRequest(t, h, p.ID, "parse", `{"action":"claim"}`, 200)
	old := j.Token
	request(t, h, "PUT", "/papers/"+p.ID+"/reading/pages/1", "[]", nil)
	jobRequest(t, h, p.ID, "parse", jobBody(map[string]any{"action": "complete", "token": old}), 409)
	j = jobRequest(t, h, p.ID, "parse", jobBody(map[string]any{"action": "pause", "revision": j.Revision}), 200)
	jobRequest(t, h, p.ID, "parse", jobBody(map[string]any{"action": "progress", "token": old, "done": 1, "total": 2}), 409)
	j = jobRequest(t, h, p.ID, "parse", jobBody(map[string]any{"action": "resume", "revision": j.Revision}), 200)
	j = jobRequest(t, h, p.ID, "parse", `{"action":"claim"}`, 200)
	if j.Token == old || j.Token == "" {
		t.Fatal("lease reused")
	}
	request(t, h, "PUT", "/papers/"+p.ID+"/reading/pages/2", "[]", nil)
	j = jobRequest(t, h, p.ID, "parse", jobBody(map[string]any{"action": "complete", "token": j.Token}), 200)
	if j.Done != 2 || j.Total != 2 || j.State != "done" {
		t.Fatal(j)
	}
	w.db.Exec("UPDATE papers SET deleted_at=? WHERE id=?", now(), p.ID)
	jobRequest(t, h, p.ID, "parse", `{"action":"start"}`, 404)
}
func TestPaperTranslationGatesAndUnfinishedCompletion(t *testing.T) {
	root := t.TempDir()
	w, e := Open(root)
	if e != nil {
		t.Fatal(e)
	}
	defer func() { w.Close() }()
	h := w.Handler(testHost, testToken)
	p, _, _ := importFixture(t, h, "%PDF-1.7 translation jobs")
	body := `{"action":"start","payload":{"scope":"paper","model":"fixture-model","effort":"high","revision":0}}`
	jobRequest(t, h, p.ID, "translate", body, 409)
	request(t, h, "PUT", "/papers/"+p.ID+"/preview-info", `{"pages":1}`, nil)
	request(t, h, "PUT", "/papers/"+p.ID+"/reading/pages/1", `[{"kind":"text","rect":{"x":0.1,"y":0.2,"w":0.7,"h":0.1},"text":"This is one complete scientific statement."}]`, nil)
	j := jobRequest(t, h, p.ID, "translate", body, 200)
	j = jobRequest(t, h, p.ID, "translate", `{"action":"claim"}`, 200)
	jobRequest(t, h, p.ID, "translate", jobBody(map[string]any{"action": "complete", "token": j.Token}), 409)
	w.Close()
	w, e = Open(root)
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	h = w.Handler(testHost, testToken)
	r := request(t, h, "GET", "/paper-jobs", "", nil)
	var jobs []PaperJob
	json.Unmarshal(r.Body.Bytes(), &jobs)
	found := false
	for _, j := range jobs {
		if j.Stage == "translate" {
			found = true
			if j.State != "paused" || j.Token != "" {
				t.Fatal("translation silently resumed", j)
			}
			var payload TranslationRequest
			json.Unmarshal(j.Payload, &payload)
			if payload.Model != "fixture-model" || payload.Effort != "high" {
				t.Fatal("lost frozen settings")
			}
		}
	}
	if !found {
		t.Fatal("translation job lost")
	}
}
func TestSchema12BackupPreservesOldReadingAndQueuesMissingWork(t *testing.T) {
	root := t.TempDir()
	w, e := Open(root)
	if e != nil {
		t.Fatal(e)
	}
	defer func() { w.Close() }()
	h := w.Handler(testHost, testToken)
	p, _, _ := importFixture(t, h, "%PDF-1.7 migration")
	request(t, h, "PUT", "/papers/"+p.ID+"/reading/pages/1", "[]", nil)
	w.Close()
	db, e := sql.Open("sqlite", filepath.Join(root, "researchdesk-next.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("DROP TABLE translation_connections; DROP TABLE paper_jobs; DROP TABLE codex_connection; PRAGMA user_version=11"); e != nil {
		t.Fatal(e)
	}
	db.Close()
	w, e = Open(root)
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	var pages int
	w.db.QueryRow("SELECT count(*) FROM reading_pages WHERE paper_id=?", p.ID).Scan(&pages)
	if pages != 1 {
		t.Fatal("old parse lost")
	}
	var state string
	w.db.QueryRow("SELECT state FROM paper_jobs WHERE paper_id=? AND stage='parse'", p.ID).Scan(&state)
	if state != "queued" {
		t.Fatal("missing auto-parse", state)
	}
	files, _ := filepath.Glob(filepath.Join(root, "pre-schema13-*.sqlite"))
	if len(files) != 1 {
		t.Fatal("missing backup")
	}
	before, _ := sql.Open("sqlite", files[0])
	defer before.Close()
	var v int
	before.QueryRow("PRAGMA user_version").Scan(&v)
	if v != 11 {
		t.Fatal(v)
	}
}
func TestCodexConnectionRejectsLostRevision(t *testing.T) {
	w, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	path := filepath.Join(t.TempDir(), "codex.exe")
	os.WriteFile(path, []byte("test"), 0700)
	body := jobBody(map[string]any{"path": path, "revision": 0})
	if r := request(t, h, "PUT", "/translation/connection", body, nil); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if r := request(t, h, "PUT", "/translation/connection", `{"path":"","revision":0}`, nil); r.Code != 409 {
		t.Fatal("stale connection accepted", r.Code)
	}
	var saved string
	w.db.QueryRow("SELECT path FROM codex_connection").Scan(&saved)
	if saved != path {
		t.Fatal("path overwritten")
	}
}

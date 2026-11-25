package workspace

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
	"time"
)

func taskFixture(t *testing.T, w *Workspace) Agenda {
	t.Helper()
	h := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, h, "%PDF-1.7\nresearch companion")
	var a Agenda
	raw := sendJSON(t, h, http.MethodPost, "/research/tasks", ResearchTaskInput{ID: newID(), Title: "核对实验设置", Day: "2026-11-13", Source: ResearchSource{PaperID: paper.ID, Page: 2, Quote: "The experiment uses a fixed seed.", Rects: []Rect{{.1, .2, .5, .1}}}}, 201)
	json.Unmarshal(*raw, &a)
	return a
}
func snap(t *testing.T, w *Workspace) map[string]json.RawMessage {
	t.Helper()
	r := request(t, w.Handler(testHost, testToken), "GET", "/companion", "", nil)
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body)
	}
	var s map[string]json.RawMessage
	json.Unmarshal(r.Body.Bytes(), &s)
	return s
}
func focusCall(t *testing.T, w *Workspace, in FocusCommand, status int) FocusSession {
	t.Helper()
	raw := sendJSON(t, w.Handler(testHost, testToken), "POST", "/focus/command", in, status)
	var f FocusSession
	json.Unmarshal(*raw, &f)
	return f
}
func TestResearchSourceKeepsSavedMarkSnapshotAndNeverResurrectsTask(t *testing.T) {
	w, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, h, "%PDF-1.7\nannotation source")
	raw := sendJSON(t, h, "POST", "/papers/"+paper.ID+"/marks", Mark{Page: 2, Kind: "highlight", Color: "amber", Quote: "Frozen source", Rects: []Rect{{.1, .2, .5, .1}}}, 201)
	var mark Mark
	json.Unmarshal(*raw, &mark)
	input := ResearchTaskInput{ID: newID(), Title: "核对这条批注", Source: ResearchSource{PaperID: paper.ID, Page: 2, MarkID: mark.ID, MarkRevision: mark.Revision, Quote: "client cannot replace source"}}
	sendJSON(t, h, "POST", "/research/tasks", input, 201)
	w.db.Exec("DELETE FROM marks WHERE id=?", mark.ID)
	w.db.Exec("UPDATE agenda SET deleted_at='deleted',revision=2 WHERE id=?", input.ID)
	sendJSON(t, h, "POST", "/research/tasks", input, 200)
	var deleted string
	if e = w.db.QueryRow("SELECT deleted_at FROM agenda WHERE id=?", input.ID).Scan(&deleted); e != nil || deleted != "deleted" {
		t.Fatal(deleted, e)
	}
	r := request(t, h, "GET", "/research/tasks/"+input.ID+"/source", "", nil)
	var s ResearchSource
	json.Unmarshal(r.Body.Bytes(), &s)
	if r.Code != 200 || s.Quote != "Frozen source" || len(s.Rects) != 1 {
		t.Fatal(r.Code, r.Body)
	}
	input.Title = "different"
	sendJSON(t, h, "POST", "/research/tasks", input, 409)
}
func TestResearchTaskRejectsStaleOrForeignMarks(t *testing.T) {
	w, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, h, "%PDF-1.7\nsource guard")
	raw := sendJSON(t, h, "POST", "/papers/"+paper.ID+"/marks", Mark{Page: 1, Kind: "note", Color: "amber", Rects: []Rect{{.1, .2, .02, .02}}}, 201)
	var m Mark
	json.Unmarshal(*raw, &m)
	in := ResearchTaskInput{ID: newID(), Title: "source guard", Source: ResearchSource{PaperID: paper.ID, Page: 1, MarkID: m.ID, MarkRevision: 99}}
	sendJSON(t, h, "POST", "/research/tasks", in, 409)
	other, _, _ := importFixture(t, h, "%PDF-1.7\nforeign paper")
	in.Source.PaperID = other.ID
	in.Source.MarkRevision = m.Revision
	sendJSON(t, h, "POST", "/research/tasks", in, 404)
	var n int
	w.db.QueryRow("SELECT count(*) FROM agenda").Scan(&n)
	if n != 0 {
		t.Fatal(n)
	}
}
func TestFocusExpiryRequiresConfirmationAndReceiptsAreIdempotent(t *testing.T) {
	w, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	a := taskFixture(t, w)
	in := FocusCommand{RequestID: newID(), ID: newID(), Action: "start", TaskID: a.ID, TaskRevision: a.Revision, Minutes: 1}
	f := focusCall(t, w, in, 200)
	again := focusCall(t, w, in, 200)
	if f.ID != again.ID {
		t.Fatal("duplicate session")
	}
	focusCall(t, w, FocusCommand{RequestID: newID(), ID: newID(), Action: "start", TaskID: a.ID, TaskRevision: 1, Minutes: 1}, 409)
	// Five seconds left, with three seconds since a live checkpoint.
	w.db.Exec("UPDATE focus_sessions SET elapsed_seconds=58,running_since=? WHERE id=?", time.Now().Add(-3*time.Second).UTC().Format(time.RFC3339Nano), f.ID)
	s := snap(t, w)
	json.Unmarshal(s["focus"], &f)
	if f.State != "review" || f.ElapsedSeconds != 60 {
		t.Fatal(f)
	}
	var done bool
	w.db.QueryRow("SELECT done FROM agenda WHERE id=?", a.ID).Scan(&done)
	if done {
		t.Fatal("timer completed task without user confirmation")
	}
	finish := FocusCommand{RequestID: newID(), ID: f.ID, Revision: f.Revision, Action: "finish", Result: "done", Note: "核对完成"}
	f = focusCall(t, w, finish, 200)
	focusCall(t, w, finish, 200)
	if f.State != "finished" || f.Note != "核对完成" {
		t.Fatal(f)
	}
	var revision int
	w.db.QueryRow("SELECT done,revision FROM agenda WHERE id=?", a.ID).Scan(&done, &revision)
	if !done || revision != 2 {
		t.Fatal(done, revision)
	}
	finish.Note = "different"
	focusCall(t, w, finish, 409)
}
func TestFocusTaskConflictPreservesBothUserChangesAndSession(t *testing.T) {
	w, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	a := taskFixture(t, w)
	f := focusCall(t, w, FocusCommand{RequestID: newID(), ID: newID(), Action: "start", TaskID: a.ID, TaskRevision: 1, Minutes: 25}, 200)
	w.db.Exec("UPDATE agenda SET title='用户后来的修改',revision=2 WHERE id=?", a.ID)
	focusCall(t, w, FocusCommand{RequestID: newID(), ID: f.ID, Revision: f.Revision, Action: "finish", Result: "done"}, 409)
	f = focusCall(t, w, FocusCommand{RequestID: newID(), ID: f.ID, Revision: f.Revision, Action: "finish", Result: "continue", Note: "待继续"}, 200)
	if f.Result != "continue" {
		t.Fatal(f)
	}
	var title string
	var done bool
	w.db.QueryRow("SELECT title,done FROM agenda WHERE id=?", a.ID).Scan(&title, &done)
	if title != "用户后来的修改" || done {
		t.Fatal(title, done)
	}
}
func TestFocusRestartAndLongGapNeverCountOfflineTime(t *testing.T) {
	root := t.TempDir()
	w, e := Open(root)
	if e != nil {
		t.Fatal(e)
	}
	a := taskFixture(t, w)
	f := focusCall(t, w, FocusCommand{RequestID: newID(), ID: newID(), Action: "start", TaskID: a.ID, TaskRevision: 1, Minutes: 25}, 200)
	w.db.Exec("UPDATE focus_sessions SET elapsed_seconds=8,running_since=? WHERE id=?", time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano), f.ID)
	s := snap(t, w)
	json.Unmarshal(s["focus"], &f)
	if f.State != "interrupted" || f.ElapsedSeconds != 8 {
		t.Fatal(f)
	}
	f = focusCall(t, w, FocusCommand{RequestID: newID(), ID: f.ID, Revision: f.Revision, Action: "resume"}, 200)
	w.Close()
	w, e = Open(root)
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	s = snap(t, w)
	json.Unmarshal(s["focus"], &f)
	if f.State != "interrupted" || f.ElapsedSeconds != 8 {
		t.Fatal(f)
	}
}
func TestSchema9BacksUpSchema8AndOldCoreWillRejectNewVersion(t *testing.T) {
	root := t.TempDir()
	db, e := sql.Open("sqlite", filepath.Join(root, "researchdesk-next.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(schema + schema2 + schema3 + schema4 + schema5 + schema6 + schema7 + schema8)
	if e != nil {
		t.Fatal(e)
	}
	db.Close()
	w, e := Open(root)
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	files, _ := filepath.Glob(filepath.Join(root, "pre-schema*-*.sqlite"))
	if len(files) != 1 {
		t.Fatal(files)
	}
	old, e := sql.Open("sqlite", files[0])
	if e != nil {
		t.Fatal(e)
	}
	defer old.Close()
	var version int
	old.QueryRow("PRAGMA user_version").Scan(&version)
	if version != 8 {
		t.Fatal(version)
	}
	w.db.QueryRow("PRAGMA user_version").Scan(&version)
	if version != schemaVersion {
		t.Fatal(version)
	}
}

func TestCompanionContinuePrefersReadPaperOverFreshUnopenedImport(t *testing.T) {
	w, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	read, _, _ := importFixture(t, h, "%PDF-1.7\nread paper")
	sendJSON(t, h, "PUT", "/papers/"+read.ID+"/position", map[string]any{"page": 4, "zoom": 140}, 200)
	importFixture(t, h, "%PDF-1.7\nnew unopened paper")
	s := snap(t, w)
	var recent Paper
	json.Unmarshal(s["recent"], &recent)
	if recent.ID != read.ID || recent.Page != 4 || recent.Zoom != 140 {
		t.Fatal(recent)
	}
}

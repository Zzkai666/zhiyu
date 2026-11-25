package workspace

import (
	"encoding/json"
	"testing"
)

func TestAgendaVersionAndSource(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	p, _, _ := importFixture(t, h, "%PDF-1.7\nfixture")
	post := request(t, h, "POST", "/projects", `{"title":"实验项目","description":"","status":"active"}`, nil)
	if post.Code != 201 {
		t.Fatal(post.Code, post.Body)
	}
	var project Project
	if err := json.Unmarshal(post.Body.Bytes(), &project); err != nil {
		t.Fatal(err)
	}
	a := Agenda{Kind: "event", Title: "读论文", Day: "2026-11-10", Start: "10:00", End: "09:00", ProjectID: project.ID, PaperID: p.ID, PaperPage: 3}
	raw, _ := json.Marshal(a)
	if r := request(t, h, "POST", "/agenda", string(raw), nil); r.Code != 400 {
		t.Fatal(r.Code, r.Body)
	}
	a.End = "11:00"
	raw, _ = json.Marshal(a)
	post = request(t, h, "POST", "/agenda", string(raw), nil)
	if post.Code != 201 {
		t.Fatal(post.Code, post.Body)
	}
	if err := json.Unmarshal(post.Body.Bytes(), &a); err != nil {
		t.Fatal(err)
	}
	a.Done = true
	raw, _ = json.Marshal(a)
	if r := request(t, h, "PATCH", "/agenda/"+a.ID, string(raw), nil); r.Code != 200 {
		t.Fatal(r.Code, r.Body)
	}
	if r := request(t, h, "PATCH", "/agenda/"+a.ID, string(raw), nil); r.Code != 409 {
		t.Fatal(r.Code, r.Body)
	}
}

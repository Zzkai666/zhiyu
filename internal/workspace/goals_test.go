package workspace

import (
	"encoding/json"
	"net/http"
	"testing"
)

func sendJSON(t *testing.T, h http.Handler, method, path string, data any, code int) *json.RawMessage {
	t.Helper()
	body := ""
	if data != nil {
		raw, err := json.Marshal(data)
		if err != nil {
			t.Fatal(err)
		}
		body = string(raw)
	}
	result := request(t, h, method, path, body, nil)
	if result.Code != code {
		t.Fatalf("%s %s: got %d, want %d (%s)", method, path, result.Code, code, result.Body)
	}
	raw := json.RawMessage(result.Body.Bytes())
	return &raw
}

func readFixture[T any](t *testing.T, raw *json.RawMessage) T {
	t.Helper()
	var target T
	if err := json.Unmarshal(*raw, &target); err != nil {
		t.Fatal(err)
	}
	return target
}

func TestGoalProgressHistoryAndProjectMaterials(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	create := func(name string) Project {
		return readFixture[Project](t, sendJSON(t, h, "POST", "/projects", Project{Title: name, Status: "active", Area: "research", Deadline: "2026-12-01"}, 201))
	}
	one, two := create("综述"), create("复现")
	goal := Goal{ID: newID(), GoalDetails: GoalDetails{Title: "核对论文", Status: "active", Measure: GoalMeasure{Kind: "numeric", Target: 4, Unit: "篇"}}, Projects: []string{two.ID, one.ID}}
	first := readFixture[Goal](t, sendJSON(t, h, "POST", "/goals", goal, 201))
	sendJSON(t, h, "POST", "/goals", goal, 200)
	if first.Revision != 1 || len(first.Projects) != 2 {
		t.Fatal(first)
	}
	first.Measure.Current = 6
	sendJSON(t, h, "PATCH", "/goals/"+first.ID, first, 400)
	update := struct {
		Goal
		Reason string `json:"reason"`
	}{first, "核对 6 篇"}
	saved := readFixture[Goal](t, sendJSON(t, h, "PATCH", "/goals/"+first.ID, update, 200))
	if saved.Revision != 2 || saved.Status != "active" || saved.Measure.Current != 6 {
		t.Fatal(saved)
	}
	sendJSON(t, h, "PATCH", "/goals/"+first.ID, update, 200)
	first.Title = "冲突覆盖"
	update.Goal = first
	sendJSON(t, h, "PATCH", "/goals/"+first.ID, update, 409)
	saved.Measure.Kind = "manual"
	sendJSON(t, h, "PATCH", "/goals/"+saved.ID, saved, 400)
	history := readFixture[[]GoalChange](t, sendJSON(t, h, "GET", "/goals/"+first.ID+"/history", nil, 200))
	if len(history) != 2 || history[0].Reason != "核对 6 篇" || history[1].Goal.Measure.Current != 0 {
		t.Fatal(history)
	}
	if len(readFixture[[]Goal](t, sendJSON(t, h, "GET", "/goals", nil, 200))) != 1 {
		t.Fatal("duplicate goal")
	}
	paper, _, _ := importFixture(t, h, "%PDF-1.7\ngoal material fixture")
	note := readFixture[Note](t, sendJSON(t, h, "POST", "/notes", Note{Title: "摘录", PaperID: paper.ID, Page: 1}, 201))
	base := "/projects/" + one.ID + "/materials"
	link := base + "/paper/" + paper.ID
	sendJSON(t, h, "PUT", link, nil, 200)
	sendJSON(t, h, "PUT", link, nil, 200)
	sendJSON(t, h, "PUT", base+"/note/"+note.ID, nil, 200)
	if len(readFixture[[]ProjectMaterial](t, sendJSON(t, h, "GET", base, nil, 200))) != 2 {
		t.Fatal("materials missing")
	}
	note.Deleted = true
	sendJSON(t, h, "PATCH", "/notes/"+note.ID, note, 200)
	if len(readFixture[[]ProjectMaterial](t, sendJSON(t, h, "GET", base, nil, 200))) != 2 {
		t.Fatal("deleted source lost its association")
	}
	sendJSON(t, h, "DELETE", link, nil, 200)
	sendJSON(t, h, "DELETE", link, nil, 200)
	if len(readFixture[[]Paper](t, sendJSON(t, h, "GET", "/papers", nil, 200))) != 1 {
		t.Fatal("unlink changed original")
	}
	one.Status = "archived"
	sendJSON(t, h, "PATCH", "/projects/"+one.ID, one, 200)
	sendJSON(t, h, "PUT", link, nil, 409)
	if len(readFixture[[]Goal](t, sendJSON(t, h, "GET", "/goals", nil, 200))[0].Projects) != 2 {
		t.Fatal("archive removed goal links")
	}
}

func TestAgendaClientIdentityReplaysWithoutDuplicate(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	item := Agenda{ID: newID(), Kind: "task", Title: "快速记一项", Day: "2026-11-11"}
	sendJSON(t, h, "POST", "/agenda", item, 201)
	sendJSON(t, h, "POST", "/agenda", item, 200)
	item.Title = "不同的内容"
	sendJSON(t, h, "POST", "/agenda", item, 409)
	saved := readFixture[[]Agenda](t, sendJSON(t, h, "GET", "/agenda", nil, 200))
	if len(saved) != 1 || saved[0].Title != "快速记一项" {
		t.Fatal(saved)
	}
}

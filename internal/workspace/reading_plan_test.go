package workspace

import (
	"encoding/json"
	"testing"
)

func TestReadingPlanContinuation(t *testing.T) {
	left := Region{ID: "p1-b1", Page: 1, Kind: "text", Text: "This paragraph describes the results we obtained in", Rect: Rect{.1, .82, .4, .1}}
	right := Region{ID: "p2-b2", Page: 2, Kind: "text", Text: "the same experiment with a different policy.", Rect: Rect{.1, .08, .4, .1}}
	art := Region{ID: "p2-b1", Page: 2, Kind: "figure", Rect: Rect{.5, .02, .4, .3}}
	pages := []int{1, 2}
	parts := []Region{left, art, right}
	p := makeReadingPlan(pages, parts, ReadingEdits{}, 0)
	if len(p.Groups) != 2 || !p.Groups[0].Auto || len(p.Groups[0].Regions) != 2 ||
		p.Groups[0].Text != "This paragraph describes the results we obtained in the same experiment with a different policy." {
		t.Fatalf("%+v", p)
	}
	p = makeReadingPlan(pages, parts, ReadingEdits{Joins: []Join{{left.ID, right.ID, true}}}, 1)
	if len(p.Groups) != 3 {
		t.Fatalf("split was ignored: %+v", p)
	}
}
func TestReadingGroupEditsPersist(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	handler := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, handler, "%PDF-1.7\nreading")
	path := "/papers/" + paper.ID + "/reading"
	for _, p := range []string{"1", "2"} {
		r := request(t, handler, "PUT", path+"/pages/"+p, `[{"kind":"text","rect":{"x":0.1,"y":0.4,"w":0.3,"h":0.1},"text":"A complete candidate paragraph."}]`, nil)
		if r.Code != 200 {
			t.Fatal(r.Code, r.Body)
		}
	}
	payload := `{"revision":0,"action":"join","first":"p2-b1","second":"p1-b1"}`
	r := request(t, handler, "PATCH", path, payload, nil)
	var out ReadingPlan
	if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &out) != nil || len(out.Groups) != 1 || len(out.Groups[0].Regions) != 2 {
		t.Fatal(r.Code, r.Body)
	}
	if r = request(t, handler, "PATCH", path, payload, nil); r.Code != 409 {
		t.Fatal(r.Code, r.Body)
	}
	if r = request(t, handler, "PATCH", path, `{"revision":1,"action":"split","first":"p1-b1"}`, nil); r.Code != 200 {
		t.Fatal(r.Code, r.Body)
	}
	if json.Unmarshal(r.Body.Bytes(), &out) != nil || len(out.Groups) != 2 {
		t.Fatal(r.Body)
	}
}
func TestPublicImportRejectsLocalAddresses(t *testing.T) {
	for _, s := range []string{"http://arxiv.org/pdf/1", "https://127.0.0.1/", "https://[::ffff:127.0.0.1]/", "https://100.100.100.100/", "https://user@arxiv.org/"} {
		if _, err := resolveImport(t.Context(), s); err == nil {
			t.Fatal(s)
		}
	}
}

package workspace

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSamePageContinuationsAndAuthorMetadata(t *testing.T) {
	regions := []Region{
		{ID: "p1-b1", Page: 1, Kind: "title", Text: "Robot learning", Rect: Rect{.06, .07, .72, .06}},
		{ID: "p1-b2", Page: 1, Kind: "text", Text: "1 Department of Computer Science, Example University (e-mail: person@example.org)", Rect: Rect{.06, .17, .72, .02}},
		{ID: "p1-b3", Page: 1, Kind: "text", Text: "This research was partially supported by a grant.", Rect: Rect{.06, .2, .72, .02}},
		{ID: "p1-b4", Page: 1, Kind: "abstract", Text: "The abstract begins here.", Rect: Rect{.06, .27, .72, .1}},
		{ID: "p3-b1", Page: 3, Kind: "text", Text: "Training often builds on pre-trained models and fine-tunes them", Rect: Rect{.057, .81, .43, .12}},
		{ID: "p3-b2", Page: 3, Kind: "text", Text: "for downstream tasks using high-quality expert demonstrations.", Rect: Rect{.51, .077, .43, .26}},
		{ID: "p4-b1", Page: 4, Kind: "text", Text: "The experiments in this paper were designed to compare", Rect: Rect{.06, .14, .42, .07}},
		{ID: "p4-b2", Page: 4, Kind: "figure", Rect: Rect{.06, .22, .42, .2}},
		{ID: "p4-b3", Page: 4, Kind: "caption", Text: "Figure 2. Experiment design.", Rect: Rect{.06, .43, .42, .025}},
		{ID: "p4-b4", Page: 4, Kind: "text", Text: "the two methods under otherwise identical conditions.", Rect: Rect{.06, .46, .42, .07}},
	}
	p := makeReadingPlan([]int{1, 3, 4}, regions, ReadingEdits{}, 0)
	if p.Groups[1].Regions[0].Kind != "author" || p.Groups[1].Translate || p.Groups[2].Regions[0].Kind != "text" {
		t.Fatalf("author metadata: %+v", p.Groups[:4])
	}
	if len(p.Groups[4].Regions) != 2 || !p.Groups[4].Auto || !strings.Contains(p.Groups[4].Text, "them for downstream") {
		t.Fatalf("cross-column: %+v", p.Groups[4])
	}
	if len(p.Groups[5].Regions) != 2 || !p.Groups[5].Auto || !strings.Contains(p.Groups[5].Text, "compare the two methods") {
		t.Fatalf("floating region: %+v", p.Groups[5])
	}
	regions[4].Text += "."
	if next := makeReadingPlan([]int{1, 3, 4}, regions, ReadingEdits{}, 0); len(next.Groups[4].Regions) != 1 {
		t.Fatalf("connected a completed sentence: %+v", next.Groups[4])
	}
}

func TestReadingJoinThreeGroupsPreservesReadingOrder(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, h, "%PDF-1.7\nreading multi")
	path := "/papers/" + paper.ID + "/reading"
	if r := request(t, h, "PUT", path+"/pages/1", `[
  {"kind":"text","rect":{"x":0.1,"y":0.25,"w":0.3,"h":0.1},"text":"First block."},
  {"kind":"figure","rect":{"x":0.1,"y":0.35,"w":0.3,"h":0.1},"text":""},
  {"kind":"text","rect":{"x":0.1,"y":0.45,"w":0.3,"h":0.1},"text":"Second block."}
 ]`, nil); r.Code != 200 {
		t.Fatal(r.Code, r.Body)
	}
	if r := request(t, h, "PUT", path+"/pages/2", `[
  {"kind":"text","rect":{"x":0.1,"y":0.25,"w":0.3,"h":0.1},"text":"Third block."}
 ]`, nil); r.Code != 200 {
		t.Fatal(r.Code, r.Body)
	}
	r := request(t, h, "PATCH", path, `{"revision":0,"action":"join","selected":["p2-b1","p1-b1","p1-b3"]}`, nil)
	var out ReadingPlan
	if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &out) != nil || len(out.Groups) != 2 {
		t.Fatal(r.Code, r.Body)
	}
	if len(out.Groups[0].Regions) != 3 || out.Groups[0].Text != "First block. Second block. Third block." || out.Groups[1].Regions[0].Kind != "figure" {
		t.Fatal(r.Body)
	}
}

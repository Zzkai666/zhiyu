package workspace

import (
	"encoding/json"
	"testing"
)

func TestRegionCorrectionDetachesOnlySelectedFragment(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	p, _, _ := importFixture(t, h, "%PDF-1.7 labeled fragments")
	base := "/papers/" + p.ID + "/reading"
	var regions []Region
	for index, text := range []string{"First source.", "Misidentified metadata.", "Third source.", "Fourth source."} {
		regions = append(regions, Region{Kind: "text", Rect: Rect{.1, .15 + float64(index)*.16, .4, .06}, Text: text})
	}
	if r := request(t, h, "PUT", base+"/pages/1", jobBody(regions), nil); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	read := func(action string, data map[string]any, status int) ReadingPlan {
		t.Helper()
		var plan ReadingPlan
		r := request(t, h, action, base, jobBody(data), nil)
		if r.Code != status {
			t.Fatalf("status %d, want %d: %s", r.Code, status, r.Body.String())
		}
		if status == 200 {
			if e := json.Unmarshal(r.Body.Bytes(), &plan); e != nil {
				t.Fatal(e)
			}
		}
		return plan
	}
	join := read("PATCH", map[string]any{"action": "join", "first": "p1-b1", "selected": []string{"p1-b1", "p1-b2", "p1-b3", "p1-b4"}}, 200)
	read("PATCH", map[string]any{"action": "split-edge", "revision": join.Revision, "first": "p1-b1", "second": "p1-b3"}, 409)
	split := read("PATCH", map[string]any{"action": "split-edge", "revision": join.Revision, "first": "p1-b2", "second": "p1-b1"}, 200)
	if len(split.Groups) != 2 || len(split.Groups[1].Regions) != 3 {
		t.Fatal("split affected unrelated edges", split.Groups)
	}
	corrected := read("PATCH", map[string]any{"action": "correct-region", "revision": split.Revision, "first": "p1-b2", "kind": "margin", "translate": true}, 200)
	if len(corrected.Groups) != 3 || corrected.Groups[1].Translate || corrected.Groups[1].Regions[0].Kind != "margin" ||
		len(corrected.Groups[2].Regions) != 2 || corrected.Groups[2].Regions[0].ID != "p1-b3" {
		t.Fatal("wrong label or unaffected links changed", corrected.Groups)
	}
	reloaded := read("GET", nil, 200)
	if reloaded.Revision != corrected.Revision || len(reloaded.Groups[2].Regions) != 2 {
		t.Fatal("correction did not persist")
	}
	read("PATCH", map[string]any{"action": "correct-region", "revision": split.Revision, "first": "p1-b2", "kind": "text"}, 409)
}

func TestMetadataFooterClassificationIsLocalAndHonorsManualLabel(t *testing.T) {
	footer := Region{ID: "p1-b2", Page: 1, Kind: "text", Rect: Rect{.10, .93, .57, .027}, Text: "Corresponding author(s): sample@institution.example © 2023 Publisher. All rights reserved"}
	prose := Region{ID: "p1-b1", Page: 1, Kind: "text", Rect: Rect{.10, .68, .8, .20}, Text: "Our approach generalizes to the whole set. However,"}
	continuation := Region{ID: "p2-b1", Page: 2, Kind: "text", Rect: Rect{.10, .10, .8, .15}, Text: "it remains unclear how to obtain those capabilities in the real world."}
	regions := []Region{prose, footer, continuation}
	plan := makeReadingPlan([]int{1, 2}, regions, ReadingEdits{}, 0)
	if len(plan.Groups) != 2 || len(plan.Groups[0].Regions) != 2 || plan.Groups[0].Regions[1].ID != continuation.ID ||
		plan.Groups[1].Regions[0].Kind != "margin" || plan.Groups[1].Translate {
		t.Fatal(plan.Groups)
	}
	override := ReadingEdits{Regions: map[string]RegionEdit{footer.ID: {Kind: "text"}}}
	manual := makeReadingPlan([]int{1, 2}, regions, override, 1)
	if manual.Groups[1].Regions[0].Kind != "text" {
		t.Fatal("manual label was overridden")
	}
	footer.Rect.Y = .50
	notFooter := makeReadingPlan([]int{1}, []Region{footer}, ReadingEdits{}, 0)
	if notFooter.Groups[0].Regions[0].Kind != "text" {
		t.Fatal("classified middle-page text as footer")
	}
}

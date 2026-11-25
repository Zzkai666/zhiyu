package workspace

import (
	"net/http"
	"testing"
)

func TestReadingMergePreservesOnlySelectedAndRejectsStaleCommit(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, h, "%PDF-1.7\nmerge fixture")
	blocks := []Region{
		{Kind: "text", Text: "First complete paragraph.", Rect: Rect{.1, .1, .35, .1}},
		{Kind: "figure", Rect: Rect{.1, .23, .35, .1}},
		{Kind: "caption", Text: "Figure 1. An independent caption.", Rect: Rect{.1, .35, .35, .06}},
		{Kind: "text", Text: "Second complete paragraph.", Rect: Rect{.1, .48, .35, .1}},
		{Kind: "text", Text: "Unselected paragraph remains independent.", Rect: Rect{.1, .7, .35, .1}},
	}
	sendJSON(t, h, http.MethodPut, "/papers/"+paper.ID+"/reading/pages/1", blocks, 200)
	plan, edits, err := w.readReadingPlan(t.Context(), paper.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Groups) != 5 {
		t.Fatalf("fixture grouping %d", len(plan.Groups))
	}
	a, b, other := plan.Groups[0], plan.Groups[3], plan.Groups[4]
	for _, g := range []ReadingGroup{a, b, other} {
		if _, err = w.db.Exec("INSERT INTO reading_translations VALUES(?,?,?,?,?,?)", paper.ID, g.ID, "old "+g.Text, "fixture", "medium", now()); err != nil {
			t.Fatal(err)
		}
	}
	input := mergeTranslationInput{Groups: []string{b.ID, a.ID}, Revision: plan.Revision, Model: "fixture", Effort: "medium"}
	_, _, joined, err := mergeTranslationCandidate(plan, edits, input.Groups)
	if err != nil {
		t.Fatal(err)
	}
	if len(joined.Regions) != 2 || joined.Regions[0].ID != a.Regions[0].ID || joined.Text != "First complete paragraph. Second complete paragraph." {
		t.Fatal("not explicit selection in reading order", joined)
	}
	unchanged, _, _ := w.readReadingPlan(t.Context(), paper.ID)
	if len(unchanged.Groups) != 5 {
		t.Fatal("candidate changed active reading")
	}
	if _, err = w.db.Exec("INSERT INTO reading_translations VALUES(?,?,?,?,?,?)", paper.ID, joined.ID, "earlier joined translation", "fixture", "medium", now()); err != nil {
		t.Fatal(err)
	}
	if err = w.commitMergedTranslation(t.Context(), paper.ID, input, joined, "完整的新译文"); err != nil {
		t.Fatal(err)
	}
	updated, _, err := w.readReadingPlan(t.Context(), paper.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Groups) != 4 || updated.Groups[0].Translation != "完整的新译文" || updated.Groups[1].Regions[0].Kind != "figure" || updated.Groups[2].Regions[0].Kind != "caption" || updated.Groups[3].ID != other.ID || updated.Groups[3].Translation != "old "+other.Text {
		t.Fatal("unselected content or previous translation changed", updated)
	}
	var count int
	_ = w.db.QueryRow("SELECT count(*) FROM reading_translations WHERE paper_id=?", paper.ID).Scan(&count)
	if count != 4 {
		t.Fatal("old translations removed")
	}
	if err = w.commitMergedTranslation(t.Context(), paper.ID, input, joined, "stale"); err == nil {
		t.Fatal("stale merge adopted")
	}
	if _, _, _, err = mergeTranslationCandidate(plan, edits, []string{a.ID, plan.Groups[1].ID}); err == nil {
		t.Fatal("figure accepted as paragraph")
	}
	if _, _, _, err = mergeTranslationCandidate(plan, edits, []string{a.ID, a.ID}); err == nil {
		t.Fatal("duplicate accepted")
	}
}

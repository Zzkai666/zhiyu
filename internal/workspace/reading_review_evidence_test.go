package workspace

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReviewDistinguishesCitationContinuationFromOrdinaryPageBreak(t *testing.T) {
	first := Region{ID: "p3-b1", Page: 3, Kind: "text", Rect: Rect{.53, .78, .4, .12},
		Text: "The related work compares the published datasets (Example et al.,"}
	float := Region{ID: "p4-b1", Page: 4, Kind: "table", Rect: Rect{.1, .04, .8, .22}}
	footnote := Region{ID: "p3-b2", Page: 3, Kind: "text", Rect: Rect{.53, .91, .4, .04}, Text: "∗Due to an issue, fewer initializations were used."}
	second := Region{ID: "p4-b3", Page: 4, Kind: "text", Rect: Rect{.09, .53, .4, .1},
		Text: "2019) and its continuation with current results."}
	plan := makeReadingPlan([]int{3, 4}, []Region{first, footnote, float, second}, ReadingEdits{}, 0)
	if len(plan.Review) != 1 || plan.Review[0].First != first.ID || plan.Review[0].Second != second.ID ||
		!strings.Contains(strings.Join(plan.Review[0].Evidence, " "), "未闭合") {
		t.Fatalf("lost the citation seam across the float: %+v", plan.Review)
	}
	first.Text = "Results for the standard benchmark"
	second.Text = "Another Section may begin without an explicit heading."
	plan = makeReadingPlan([]int{3, 4}, []Region{first, footnote, float, second}, ReadingEdits{}, 0)
	if len(plan.Review) != 0 || len(plan.OtherReview) != 1 {
		t.Fatalf("page boundary and missing punctuation alone should be optional: %+v / %+v", plan.Review, plan.OtherReview)
	}
}

func TestReviewOverlapRemainsExplicitAndDoesNotRewriteGroups(t *testing.T) {
	body := Region{ID: "p7-b1", Page: 7, Kind: "text", Rect: Rect{.48, .25, .39, .08},
		Text: "This paragraph describes complete experiment results that the reader needs to keep."}
	figure := Region{ID: "p7-b2", Page: 7, Kind: "table", Rect: Rect{.1, .1, .7, .4}}
	plan := makeReadingPlan([]int{7}, []Region{body, figure}, ReadingEdits{}, 0)
	if len(plan.Review) != 1 || plan.Review[0].First != body.ID || len(plan.Groups) != 2 || plan.Groups[0].Text != body.Text {
		t.Fatalf("overlap should be visible without changing sources: %+v", plan)
	}
	key := reviewKey(body.ID, "")
	checked := makeReadingPlan([]int{7}, []Region{body, figure}, ReadingEdits{Reviewed: map[string]bool{key: true}}, 1)
	if len(checked.Review) != 0 || len(checked.ConfirmedReview) != 1 || checked.Groups[0].ID != plan.Groups[0].ID {
		t.Fatalf("confirmation changed source identity: %+v", checked)
	}
}

func TestReviewChainDecisionValidatesEverySeamAndRetainsOtherQualityChecks(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	p, _, _ := importFixture(t, h, "%PDF-1.7 chain decisions")
	base := "/papers/" + p.ID + "/reading"
	regions := []Region{
		{Kind: "text", Rect: Rect{.08, .20, .42, .08}, Text: "The benchmark measures the practical effect of"},
		{Kind: "text", Rect: Rect{.08, .29, .42, .08}, Text: "using several models under otherwise identical"},
		{Kind: "text", Rect: Rect{.08, .38, .42, .08}, Text: "experimental conditions on all tasks."},
		{Kind: "heading", Rect: Rect{.08, .52, .42, .04}, Text: "Other material"},
		{Kind: "text", Rect: Rect{.08, .58, .42, .08}, Text: "The extracted word � cannot be read."},
	}
	if r := request(t, h, "PUT", base+"/pages/1", jobBody(regions), nil); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	read := func() ReadingPlan {
		t.Helper()
		r := request(t, h, "GET", base, "", nil)
		var plan ReadingPlan
		if e := json.Unmarshal(r.Body.Bytes(), &plan); e != nil || r.Code != 200 {
			t.Fatal(r.Code, e, r.Body.String())
		}
		return plan
	}
	change := func(action string, rev int, last string, status int) {
		t.Helper()
		data := jobBody(map[string]any{"revision": rev, "action": action, "first": "p1-b1", "second": "p1-b2", "selected": []string{"p1-b1", "p1-b2", last}})
		if r := request(t, h, "PATCH", base, data, nil); r.Code != status {
			t.Fatal(r.Code, r.Body.String())
		}
	}
	before := read()
	if len(before.Review) != 3 {
		t.Fatal(before.Review)
	}
	change("keep", before.Revision, "p1-b5", 409)
	if read().Revision != before.Revision {
		t.Fatal("invalid selection partially saved")
	}
	change("keep", before.Revision, "p1-b3", 200)
	kept := read()
	if len(kept.ConfirmedReview) != 2 || len(kept.Review) != 1 || kept.Review[0].First != "p1-b5" {
		t.Fatal(kept)
	}
	change("recheck", kept.Revision, "p1-b3", 200)
	reopened := read()
	if r := request(t, h, "PATCH", base, jobBody(map[string]any{"action": "review-all", "revision": reopened.Revision, "first": ""}), nil); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	final := read()
	if len(final.Review) != 1 || final.Review[0].First != "p1-b5" {
		t.Fatal("bulk seam decision silently accepted a quality finding", final.Review)
	}
}

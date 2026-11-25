package workspace

import "testing"

func TestReviewContinuationKeepsManualEditsAndAllowsExtendingAGroup(t *testing.T) {
	regions := []Region{
		{ID: "p1-b1", Page: 1, Kind: "text", Rect: Rect{.1, .2, .38, .1}, Text: "The explanation of the previously defined objective"},
		{ID: "p1-b2", Page: 1, Kind: "text", Rect: Rect{.1, .31, .38, .1}, Text: "Continues with additional measurements from our experiment"},
		{ID: "p1-b3", Page: 1, Kind: "text", Rect: Rect{.1, .43, .38, .1}, Text: "and presents the full outcome as a combined result."},
	}
	edits := ReadingEdits{Regions: map[string]RegionEdit{}}
	plan := makeReadingPlan([]int{1}, regions, edits, 0)
	if len(plan.Review) != 2 || len(plan.Groups) != 3 {
		t.Fatalf("unreviewed groups: %+v", plan.Review)
	}
	joined, ok := joinSelected(plan, edits, []string{"p1-b1", "p1-b2"})
	if !ok {
		t.Fatal("failed to connect explicit selection")
	}
	next := makeReadingPlan([]int{1}, regions, joined, 1)
	if len(next.Review) != 1 || next.Review[0].First != "p1-b2" || next.Review[0].Second != "p1-b3" || len(next.Groups[0].Regions) != 2 {
		t.Fatalf("manual edit or pending continuation lost: %+v %+v", next.Review, next.Groups)
	}
	joined.Reviewed = map[string]bool{reviewKey("p1-b2", "p1-b3"): true}
	last := makeReadingPlan([]int{1}, regions, joined, 2)
	if len(last.Review) != 0 || len(last.Groups) != 2 || last.Groups[0].ID != next.Groups[0].ID {
		t.Fatal("review changed group identity")
	}
}

func TestLabelReviewDoesNotProposeJoiningAuthorNotesIntoBody(t *testing.T) {
	regions := []Region{
		{ID: "p1-b1", Page: 1, Kind: "text", Rect: Rect{.1, .2, .38, .1}, Text: "The explanation of the previously defined objective"},
		{ID: "p1-b2", Page: 1, Kind: "text", Rect: Rect{.1, .31, .38, .05}, Text: "Correspondence to: author@example.org"},
		{ID: "p1-b3", Page: 1, Kind: "figure", Rect: Rect{.1, .48, .5, .2}, LabelUncertain: true},
	}
	edits := ReadingEdits{}
	plan := makeReadingPlan([]int{1}, regions, edits, 0)
	if len(plan.Review) != 0 || len(plan.OtherReview) != 2 ||
		plan.OtherReview[0].Category != "label" || plan.OtherReview[0].SuggestedKind != "author" ||
		plan.OtherReview[1].Category != "label" || plan.OtherReview[1].First != "p1-b3" {
		t.Fatalf("label issues were not offered independently: %+v", plan)
	}
	keys := reviewDecisionKeys(plan.OtherReview, "p1-b2", "", nil, false)
	if len(keys) != 1 {
		t.Fatal("label confirmation did not find its review key", keys)
	}
	edits.Reviewed = map[string]bool{keys[0]: true}
	next := makeReadingPlan([]int{1}, regions, edits, 1)
	if len(next.ConfirmedReview) != 1 || next.ConfirmedReview[0].Category != "label" {
		t.Fatal("label confirmation was not retained", next.ConfirmedReview)
	}
	edits.Regions = map[string]RegionEdit{"p1-b2": {Kind: "author"}}
	corrected := makeReadingPlan([]int{1}, regions, edits, 2)
	if len(corrected.ConfirmedReview) != 0 || len(corrected.OtherReview) != 1 || corrected.Groups[1].Regions[0].Kind != "author" {
		t.Fatal("manually saved labels should supersede suggestions", corrected)
	}
}

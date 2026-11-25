package workspace

import "testing"

func TestReviewFindsMissedVLASeams(t *testing.T) {
	text := func(id string, page int, r Rect, s string) Region {
		return Region{ID: id, Page: page, Kind: "text", Rect: r, Text: s}
	}
	cases := []struct {
		name          string
		regions       []Region
		first, second string
	}{
		{"column begins below a large figure", []Region{
			text("p4-b4", 4, Rect{.057, .657, .431, .276}, "RT-2 is jointly fine-"),
			text("p4-b5", 4, Rect{.510, .505, .431, .124}, "tuned on both internet-scale vision-language tasks and robotic data."),
		}, "p4-b4", "p4-b5"},
		{"capitalized continuation after full-width figure", []Region{
			text("p6-b9", 6, Rect{.510, .825, .430, .107}, "Examples include Diffusion-VLA, DexVLA, ChatVLA, and GO-1,"),
			{ID: "p7-b1", Page: 7, Kind: "figure", Rect: Rect{.1, .07, .8, .43}},
			{ID: "p7-b2", Page: 7, Kind: "caption", Rect: Rect{.06, .51, .88, .08}, Text: "FIGURE 4. Model architectures."},
			text("p7-b3", 7, Rect{.057, .618, .429, .077}, "PointVLA, MoLe-VLA, and CronusVLA adopt this architecture."),
		}, "p6-b9", "p7-b3"},
		{"figure labels must not hide the real page continuation", []Region{
			text("p7-b9", 7, Rect{.510, .840, .431, .092}, "Video generation starts from an initial obser-"),
			{ID: "p8-b1", Page: 8, Kind: "figure", Rect: Rect{.117, .086, .2, .184}},
			text("p8-b2", 8, Rect{.130, .282, .153, .031}, "(1) Action generation in world models"),
			{ID: "p8-b7", Page: 8, Kind: "caption", Rect: Rect{.058, .338, .879, .045}, Text: "FIGURE 5. Architectures."},
			text("p8-b8", 8, Rect{.057, .410, .430, .352}, "vation image and task instruction. Then the model predicts future actions."),
		}, "p7-b9", "p8-b8"},
		{"short right-column fragment", []Region{
			text("p17-b5", 17, Rect{.057, .611, .430, .322}, "GELLO adapts the system by employing a follower robot with proportionally"),
			text("p17-b6", 17, Rect{.513, .512, .154, .015}, "adjusted link lengths."),
		}, "p17-b5", "p17-b6"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pages := []int{}
			for _, r := range c.regions {
				if len(pages) == 0 || pages[len(pages)-1] != r.Page {
					pages = append(pages, r.Page)
				}
			}
			plan := makeReadingPlan(pages, c.regions, ReadingEdits{}, 0)
			found := false
			for _, r := range plan.Review {
				found = found || r.First == c.first && r.Second == c.second
			}
			for _, g := range plan.Groups {
				if len(g.Regions) > 1 && g.Regions[0].ID == c.first && g.Regions[len(g.Regions)-1].ID == c.second {
					found = true
				}
			}
			if !found {
				t.Fatalf("missed genuine seam %s -> %s", c.first, c.second)
			}
		})
	}
}

func TestSentenceEndCanStillBeInsideAParagraph(t *testing.T) {
	a := Region{ID: "p1-b1", Page: 1, Kind: "text", Rect: Rect{.06, .65, .43, .28}, Text: "The first sentence describes this architecture.",
		Flow: &ReadingFlow{Version: 1, Lines: 12, FirstX: .08, LastRight: .485, Left: .06, Right: .49, FontX: .017, Step: .015}}
	b := Region{ID: "p1-b2", Page: 1, Kind: "text", Rect: Rect{.51, .15, .43, .2}, Text: "The same paragraph continues with another sentence.",
		Flow: &ReadingFlow{Version: 1, Lines: 9, FirstX: .511, LastRight: .88, Left: .51, Right: .94, FontX: .017, Step: .015}}
	plan := makeReadingPlan([]int{1}, []Region{a, b}, ReadingEdits{}, 0)
	if len(plan.Review) != 1 || plan.Review[0].Second != b.ID {
		t.Fatalf("sentence boundary hid paragraph continuation: %+v", plan.Review)
	}
	// An indented first line suggests a new paragraph, and remains accessible for extra review.
	b.Flow.FirstX = .535
	plan = makeReadingPlan([]int{1}, []Region{a, b}, ReadingEdits{}, 0)
	if len(plan.Review) != 0 || len(plan.OtherReview) != 1 {
		t.Fatal("indented paragraph was not separated from strong candidates")
	}
}

func TestFlowMetadataDoesNotChangeTranslationFingerprint(t *testing.T) {
	region := Region{ID: "p1-b1", Page: 1, Kind: "text", Rect: Rect{.1, .2, .38, .2}, Text: "This is an already translated paragraph."}
	original := makeReadingPlan([]int{1}, []Region{region}, ReadingEdits{}, 0)
	region.Flow = &ReadingFlow{Version: 1, Lines: 8, FirstX: .12, LastRight: .44, Left: .1, Right: .48, FontX: .015, Step: .02}
	measured := makeReadingPlan([]int{1}, []Region{region}, ReadingEdits{}, 0)
	if original.Groups[0].ID != measured.Groups[0].ID {
		t.Fatal("metadata invalidated the original translation association")
	}
}

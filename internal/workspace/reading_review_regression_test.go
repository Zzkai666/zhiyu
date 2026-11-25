package workspace

import "testing"

func TestReviewDoesNotSuggestJoiningCompleteParagraphsOrLists(t *testing.T) {
	cases := []struct{ name, left, right string }{
		{"watermark contaminating a complete paragraph", "The result supports applications for generalisable robotic systems [5]–[7]. arXiv:2510.07077v1 [cs.RO] 8 Oct 2025", "Earlier works decouple LLMs and VLMs from the underlying robot policies."},
		{"citation follows sentence punctuation", "The result supports applications for generalisable robotic systems. [5]–[7]", "another independent result is discussed here."},
		{"sentence before citation", "The result supports applications for generalisable robotic systems [5]–[7].", "Earlier works decouple LLMs and VLMs from the underlying robot policies."},
		{"numbered list", "The following section introduces action generation in world models:", "(1) Action generation in world models"},
		{"bulleted list", "Representative models are listed in the following survey.", "• PaLM-E [38], developed by Google, has been used along with PaLI-X [39]."},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			regions := []Region{
				{ID: "p1-b1", Page: 1, Kind: "text", Rect: Rect{.1, .2, .38, .1}, Text: item.left},
				{ID: "p1-b2", Page: 1, Kind: "text", Rect: Rect{.1, .31, .38, .1}, Text: item.right},
			}
			plan := makeReadingPlan([]int{1}, regions, ReadingEdits{}, 0)
			for _, review := range plan.Review {
				if review.Second != "" {
					t.Fatalf("false continuation: %s -> %s", item.left, item.right)
				}
			}
		})
	}
}

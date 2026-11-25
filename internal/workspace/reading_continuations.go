package workspace

import (
	"regexp"
	"slices"
	"strings"
	"unicode"
)

var authorAffiliation = regexp.MustCompile(`(?i)^(?:[\d¹²³⁰-⁹*,†‡\s.]+)?(?:department|dept\.|school|faculty|college|university|institute|laboratory|centre|center|affiliation|corresponding author|correspondence|equal (?:advising|contribution)|these authors contributed equally)\b`)

var contactFooter = regexp.MustCompile(`(?i)^corresponding\s+authors?(?:\(s\))?\s*[:：]`)
var copyrightFooter = regexp.MustCompile(`(?i)^(?:©\s*(?:19|20)[0-9]{2}\b|copyright\b)`)

func classifyMetadataFooters(regions []Region) {
	for i := range regions {
		region := &regions[i]
		if region.Kind != "text" || region.Rect.Y < .85 || region.Rect.H > .08 {
			continue
		}
		text := strings.TrimSpace(region.Text)
		if len(strings.Fields(text)) > 55 {
			continue
		}
		if contactFooter.MatchString(text) && strings.Contains(text, "@") ||
			copyrightFooter.MatchString(text) && strings.Contains(strings.ToLower(text), "all rights reserved") {
			region.Kind = "margin"
		}
	}
}

func classifyAuthorRegions(regions []Region) {
	bottom, limit := 0.0, .4
	for _, region := range regions {
		if region.Page != 1 {
			break
		}
		if region.Kind == "title" {
			bottom = max(bottom, region.Rect.Y+region.Rect.H)
		}
		if region.Kind == "abstract" || strings.EqualFold(strings.TrimSpace(region.Text), "abstract") {
			limit = min(limit, region.Rect.Y)
		}
	}
	if bottom == 0 {
		return
	}
	for i := range regions {
		region := &regions[i]
		if region.Page != 1 {
			break
		}
		if region.Kind != "text" || region.Rect.Y < bottom-.004 || region.Rect.Y >= limit || region.Rect.H > .065 {
			continue
		}
		text := strings.TrimSpace(region.Text)
		if authorAffiliation.MatchString(text) || strings.Contains(text, "@") && authorInstitution(text) {
			region.Kind = "author"
		}
	}
}

func authorInstitution(text string) bool {
	lower := strings.ToLower(text)
	for _, name := range []string{"department", "university", "institute", "laboratory", "e-mail", "email"} {
		if strings.Contains(lower, name) {
			return true
		}
	}
	return false
}

func sentenceContinues(a, b Region) bool {
	if a.Kind != b.Kind || !paragraph(a.Kind) {
		return false
	}
	left, right := strings.TrimSpace(a.Text), strings.TrimSpace(b.Text)
	if len([]rune(left)) < 28 || len([]rune(right)) < 12 {
		return false
	}
	if !incompleteEnd(left) || startsList.MatchString(right) {
		return false
	}
	first := []rune(right)[0]
	bracket := strings.IndexAny(right, ")]")
	return unicode.IsLower(first) || openingCitation.MatchString(right) || unicode.IsDigit(first) && bracket >= 0 && bracket < 9
}

func columnSide(r Rect) int {
	if r.W < .24 || r.W > .54 {
		return 0
	}
	if r.X <= .24 && r.X+r.W <= .53 {
		return -1
	}
	if r.X >= .46 && r.X <= .67 {
		return 1
	}
	return 0
}

// The last left-column block can continue at the top of the next column.
func columnContinuation(regions []Region, positions []int) (int, int, bool) {
	left, right := -1, -1
	leftTop := 1.0
	for _, i := range positions {
		r := regions[i]
		if r.Uncertain {
			continue
		}
		if (r.Kind == "heading" || r.Kind == "title") && r.Rect.X < .24 {
			if left >= 0 {
				left = -1
			}
			leftTop = min(leftTop, r.Rect.Y)
		}
		if r.Kind == "heading" && r.Rect.X >= .46 && right < 0 {
			right = -2
		}
		if !paragraph(r.Kind) {
			continue
		}
		switch columnSide(r.Rect) {
		case -1:
			left = i
			leftTop = min(leftTop, r.Rect.Y)
		case 1:
			if right == -1 {
				right = i
			}
		}
	}
	if left < 0 || right < 0 || left >= right {
		return -1, -1, false
	}
	a, b := regions[left], regions[right]
	if a.Rect.Y+a.Rect.H < .79 || b.Rect.Y > leftTop+.12 || a.Rect.Y-b.Rect.Y < .22 {
		return -1, -1, false
	}
	return left, right, sentenceContinues(a, b)
}

func floatingContinuations(regions []Region, positions []int, connect func(int, int)) {
	anchor := -1
	floatingBottom := 0.0
	for _, i := range positions {
		r := regions[i]
		if r.Uncertain {
			continue
		}
		if r.Kind == "heading" || r.Kind == "title" {
			anchor = -1
			floatingBottom = 0
			continue
		}
		if paragraph(r.Kind) {
			if anchor >= 0 && floatingBottom > 0 {
				a := regions[anchor]
				if r.Rect.Y >= floatingBottom-.015 && r.Rect.Y <= floatingBottom+.08 &&
					horizontalCoverage(a.Rect, r.Rect) > .75 && sentenceContinues(a, r) {
					connect(anchor, i)
				}
			}
			anchor = i
			floatingBottom = 0
			continue
		}
		if anchor < 0 {
			continue
		}
		a := regions[anchor].Rect
		if (r.Kind == "figure" || r.Kind == "table" || r.Kind == "formula") && r.Rect.H >= .025 &&
			r.Rect.Y >= a.Y+a.H-.015 && horizontalCoverage(a, r.Rect) > .55 {
			floatingBottom = max(floatingBottom, r.Rect.Y+r.Rect.H)
		} else if r.Kind == "caption" && floatingBottom > 0 && r.Rect.Y <= floatingBottom+.045 && horizontalCoverage(a, r.Rect) > .45 {
			floatingBottom = max(floatingBottom, r.Rect.Y+r.Rect.H)
		}
	}
}

func horizontalCoverage(a, b Rect) float64 {
	return (min(a.X+a.W, b.X+b.W) - max(a.X, b.X)) / min(a.W, b.W)
}

func regionBefore(a, b Region) bool {
	if a.Page != b.Page {
		return a.Page < b.Page
	}
	return regionOrder(a.ID) < regionOrder(b.ID)
}

func joinSelected(plan ReadingPlan, edits ReadingEdits, selected []string) (ReadingEdits, bool) {
	if len(selected) < 2 || len(selected) > 128 {
		return edits, false
	}
	wanted := map[string]bool{}
	for _, id := range selected {
		if id == "" || wanted[id] {
			return edits, false
		}
		wanted[id] = true
	}
	parts := []Region{}
	groups, matched := 0, 0
	for _, g := range plan.Groups {
		count := 0
		for _, part := range g.Regions {
			if wanted[part.ID] {
				count++
			}
		}
		if count == 0 {
			continue
		}
		matched += count
		groups++
		parts = append(parts, g.Regions...)
	}
	if matched != len(wanted) || groups < 2 || len(parts) > 128 {
		return edits, false
	}
	slices.SortFunc(parts, func(a, b Region) int {
		if regionBefore(a, b) {
			return -1
		}
		if regionBefore(b, a) {
			return 1
		}
		return 0
	})
	members := map[string]bool{}
	for i, part := range parts {
		if !paragraph(part.Kind) || strings.TrimSpace(part.Text) == "" || (i > 0 && part.Page > parts[i-1].Page+1) {
			return edits, false
		}
		members[part.ID] = true
	}
	joins := make([]Join, 0, len(edits.Joins)+len(parts)-1)
	for _, link := range edits.Joins {
		if !members[link.From] && !members[link.To] || link.Broken {
			joins = append(joins, link)
		}
	}
	for i := 1; i < len(parts); i++ {
		joins = setJoin(joins, parts[i-1].ID, parts[i].ID, false)
	}
	edits.Joins = joins
	return edits, true
}

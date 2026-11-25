package workspace

import (
	"regexp"
	"slices"
	"strings"
	"unicode"
)

type ReadingReview struct {
	First         string   `json:"first"`
	Second        string   `json:"second,omitempty"`
	Reason        string   `json:"reason"`
	Evidence      []string `json:"evidence,omitempty"`
	Category      string   `json:"category,omitempty"`
	SuggestedKind string   `json:"suggestedKind,omitempty"`
}

func reviewKey(first, second string) string { return first + "/" + second }

var trailingCitations = regexp.MustCompile(`(?:\s*\[[0-9,; –—-]+\](?:\s*[–—-]\s*\[[0-9]+\])*)+$`)
var startsList = regexp.MustCompile(`^(?:[•●▪◦‣]\s*|[-–—]\s+|[(（]?[0-9]{1,3}[.)）]\s+|[(（][a-zivxlcdm]{1,6}[)）]\s+)`)

func incompleteEnd(text string) bool {
	text = strings.TrimRight(strings.TrimSpace(text), "\"'’”")
	text = strings.TrimSpace(trailingCitations.ReplaceAllString(text, ""))
	text = strings.TrimRight(text, "\"'’”)]}")
	last := []rune(text)
	return len(last) >= 3 && !strings.ContainsRune(".!?。！？:;：；", last[len(last)-1])
}
func lowercaseStart(text string) bool {
	for _, first := range strings.TrimSpace(text) {
		return unicode.IsLower(first)
	}
	return false
}

func likelyVisualOverlap(region Region, regions []Region) bool {
	if !proseLike(region.Text) || region.Flow == nil && region.Rect.H < .045 ||
		region.Flow != nil && region.Flow.Lines < 2 {
		return false
	}
	box := region.Rect
	for _, visual := range regions {
		if visual.Page != region.Page || visual.Kind != "figure" && visual.Kind != "table" {
			continue
		}
		area := visual.Rect
		x := min(box.X+box.W, area.X+area.W) - max(box.X, area.X)
		y := min(box.Y+box.H, area.Y+area.H) - max(box.Y, area.Y)
		if x > 0 && y > 0 && x*y >= box.W*box.H*.42 {
			return true
		}
	}
	return false
}

var reviewAuthorNote = regexp.MustCompile(`(?i)^(?:[\d¹²³⁰-⁹*†‡.,:()\s]+)?(?:correspondence(?:\s+to)?\s*[:：]|corresponding\s+authors?(?:\(s\))?\s*[:：]|(?:denotes\s+)?equal\s+(?:contribution|advising)\b|these authors contributed equally\b)`)
var reviewCaption = regexp.MustCompile(`(?i)^(?:fig(?:ure)?\.?|tables?)\s+[a-z]?[0-9]+(?:[.-][0-9]+)*(?:[a-z])?\s*[.:：]\s+\S`)
var reviewHeading = regexp.MustCompile(`(?i)^(?:abstract|references|bibliography|acknowledg(?:e)?ments?)\s*[:.]?$`)

func reviewRegionLabel(r Region) (reason, suggested string) {
	text := strings.TrimSpace(r.Text)
	if r.Kind == "text" || r.Kind == "heading" || r.Kind == "caption" {
		if r.Page == 1 && r.Rect.H <= .14 && len(strings.Fields(text)) <= 65 && reviewAuthorNote.MatchString(text) {
			return "可能是作者、机构或通讯信息", "author"
		}
		if r.Kind != "caption" && reviewCaption.MatchString(text) {
			return "可能是图表说明", "caption"
		}
		if r.Kind == "text" && reviewHeading.MatchString(text) {
			return "可能是独立小标题", "heading"
		}
		if (r.Rect.Y >= .89 || r.Rect.Y+r.Rect.H <= .09) && r.Rect.H <= .075 &&
			len(strings.Fields(text)) <= 24 && copyrightFooter.MatchString(text) {
			return "可能是版权或页脚信息", "margin"
		}
	}
	if r.LabelUncertain || r.Kind == "author" && r.Uncertain {
		return "当前区块类别可能需要确认", ""
	}
	return "", ""
}

func reviewContinuations(regions []Region, next, prev map[int]int, manual map[int]bool, broken map[[2]int]bool, edits ReadingEdits) ([]ReadingReview, []ReadingReview, []ReadingReview) {
	pending, more, confirmed := []ReadingReview{}, []ReadingReview{}, []ReadingReview{}
	touched := map[int]bool{}
	order := map[string]int{}
	visualsByPage := map[int][]Region{}
	suggestedNonParagraph := map[int]bool{}
	for i, r := range regions {
		order[r.ID] = i
		if r.Kind == "figure" || r.Kind == "table" {
			visualsByPage[r.Page] = append(visualsByPage[r.Page], r)
		}
		if paragraph(r.Kind) && edits.Regions[r.ID].Kind == "" && !edits.Reviewed[reviewKey(r.ID, "")] {
			_, target := reviewRegionLabel(r)
			suggestedNonParagraph[i] = target != ""
		}
	}
	for _, edge := range readingEdges(regions, edits) {
		a, b := edge.from, edge.to
		_, hasNext := next[a]
		_, hasPrev := prev[b]
		right := strings.TrimSpace(regions[b].Text)
		if hasNext || hasPrev || broken[[2]int{a, b}] ||
			startsList.MatchString(right) && !continuesDelimiter(strings.TrimSpace(regions[a].Text), right) {
			continue
		}
		if len(strings.TrimSpace(regions[a].Text)) < 3 || len(strings.TrimSpace(regions[b].Text)) < 2 {
			continue
		}
		score, evidence := edgeEvidence(regions, edge)
		reason := "同栏文字可能在段中断开"
		if edge.kind == "page" {
			reason = "跨页的两块正文可能属于同一段"
		} else if edge.kind == "column" {
			reason = "换栏的两块正文可能属于同一段"
		}
		item := ReadingReview{First: regions[a].ID, Second: regions[b].ID, Reason: reason, Evidence: evidence}
		key := reviewKey(item.First, item.Second)
		if !edits.Reviewed[key] && (suggestedNonParagraph[a] || suggestedNonParagraph[b]) {
			continue
		}
		if edits.Reviewed[key] {
			confirmed = append(confirmed, item)
		} else if score >= 5 {
			pending = append(pending, item)
		} else if edge.kind != "same" || incompleteEnd(regions[a].Text) || score >= 3 {
			more = append(more, item)
		}
		touched[a], touched[b] = true, true
	}
	for i, r := range regions {
		regionEdit, edited := edits.Regions[r.ID]
		labelReason, suggested := reviewRegionLabel(r)
		if regionEdit.Kind != "" {
			labelReason = ""
		}
		if labelReason == "" && (edited || manual[i] || !paragraph(r.Kind)) {
			continue
		}
		item := ReadingReview{First: r.ID}
		blocking := false
		switch {
		case !edited && !manual[i] && paragraph(r.Kind) && r.Translate && strings.ContainsRune(r.Text, '\ufffd'):
			item.Reason = "正文含无法提取的字形"
			item.Evidence = []string{"请核对原文是否有文字或符号被替换"}
			blocking = true
		case !edited && !manual[i] && paragraph(r.Kind) && r.Translate && likelyVisualOverlap(r, visualsByPage[r.Page]):
			item.Reason = "图表区域可能覆盖正文"
			item.Evidence = []string{"正文区域与图表重叠，请检查类别或原文区域"}
			blocking = true
		case labelReason != "":
			item.Reason, item.Category, item.SuggestedKind = labelReason, "label", suggested
		case r.Translate && r.Uncertain && !touched[i] && len(strings.TrimSpace(r.Text)) >= 12 && !figureLabel(regions, i, edits):
			item.Reason = "版面模型对这块正文把握较低"
		default:
			continue
		}
		switch {
		case edits.Reviewed[reviewKey(r.ID, "")]:
			confirmed = append(confirmed, item)
		case blocking:
			pending = append(pending, item)
		default:
			more = append(more, item)
		}
	}
	sortItems := func(items []ReadingReview) {
		slices.SortFunc(items, func(a, b ReadingReview) int {
			if diff := order[a.First] - order[b.First]; diff != 0 {
				return diff
			}
			return strings.Compare(a.Second, b.Second)
		})
	}
	sortItems(pending)
	sortItems(more)
	sortItems(confirmed)
	return pending, more, confirmed
}

func reviewDecisionKeys(candidates []ReadingReview, first, second string, selected []string, all bool) []string {
	if len(selected) == 0 || all {
		var keys []string
		for _, item := range candidates {
			if all && item.Second != "" || !all && item.First == first && item.Second == second {
				keys = append(keys, reviewKey(item.First, item.Second))
			}
		}
		return keys
	}
	if len(selected) < 3 || len(selected) > 128 || selected[0] != first || selected[1] != second {
		return nil
	}
	available := make(map[string]bool, len(candidates))
	for _, item := range candidates {
		available[reviewKey(item.First, item.Second)] = true
	}
	seen := make(map[string]bool, len(selected))
	keys := make([]string, 0, len(selected)-1)
	for i, id := range selected {
		if id == "" || seen[id] {
			return nil
		}
		seen[id] = true
		if i == 0 {
			continue
		}
		key := reviewKey(selected[i-1], id)
		if !available[key] {
			return nil
		}
		keys = append(keys, key)
	}
	return keys
}

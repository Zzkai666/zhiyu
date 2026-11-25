package workspace

import (
	"math"
	"regexp"
	"strings"
)

type readingEdge struct {
	from, to int
	kind     string
}

func columnBand(r Rect) int {
	if r.W > .64 {
		return 0
	}
	if r.X >= .46 {
		return 1
	}
	if r.X+r.W <= .55 {
		return -1
	}
	return 0
}

func figureLabel(regions []Region, index int, edits ReadingEdits) bool {
	r := regions[index]
	if !paragraph(r.Kind) || r.Rect.H > .09 || len([]rune(r.Text)) > 180 || edits.Regions[r.ID].Kind != "" {
		return false
	}
	for _, image := range regions {
		if image.Page != r.Page || (image.Kind != "figure" && image.Kind != "table") {
			continue
		}
		if horizontalCoverage(r.Rect, image.Rect) < .5 || r.Rect.Y < image.Rect.Y {
			continue
		}
		if r.Rect.Y+r.Rect.H <= image.Rect.Y+image.Rect.H+.01 {
			if proseLike(r.Text) && (r.Flow != nil && r.Flow.Lines >= 2 || r.Rect.H >= .045) {
				continue
			}
			return true
		}
		if proseLike(r.Text) || r.Rect.Y > image.Rect.Y+image.Rect.H+.08 {
			continue
		}
		for _, caption := range regions {
			if caption.Page == r.Page && caption.Kind == "caption" && caption.Rect.Y >= r.Rect.Y+r.Rect.H-.01 &&
				caption.Rect.Y-r.Rect.Y-r.Rect.H < .10 && horizontalCoverage(image.Rect, caption.Rect) > .4 {
				return true
			}
		}
	}
	return false
}

var noteMarker = regexp.MustCompile(`^[∗*†‡]\s*\p{L}`)

func bottomFootnote(region Region) bool {
	return paragraph(region.Kind) && region.Rect.Y >= .84 && region.Rect.H <= .06 &&
		noteMarker.MatchString(strings.TrimSpace(region.Text))
}

func readingEdges(regions []Region, edits ReadingEdits) []readingEdge {
	result := []readingEdge{}
	previous := -1
	for i, r := range regions {
		if r.Kind == "heading" || r.Kind == "title" || r.Kind == "reference" || r.Kind == "author" {
			previous = -1
			continue
		}
		if !paragraph(r.Kind) || bottomFootnote(r) || figureLabel(regions, i, edits) {
			continue
		}
		if previous >= 0 {
			a := regions[previous]
			if a.Kind == r.Kind && r.Page >= a.Page && r.Page <= a.Page+1 {
				switch {
				case r.Page == a.Page+1:
					result = append(result, readingEdge{previous, i, "page"})
				case columnBand(a.Rect) == -1 && columnBand(r.Rect) == 1:
					result = append(result, readingEdge{previous, i, "column"})
				case r.Rect.Y >= a.Rect.Y+a.Rect.H-.025 && horizontalCoverage(a.Rect, r.Rect) > .42:
					result = append(result, readingEdge{previous, i, "same"})
				}
			}
		}
		previous = i
	}
	return result
}

func proseLike(text string) bool {
	words := strings.Fields(text)
	return len(words) >= 10 && !startsList.MatchString(strings.TrimSpace(text)) &&
		!strings.HasPrefix(strings.ToLower(strings.TrimSpace(text)), "figure ") &&
		!strings.HasPrefix(strings.ToLower(strings.TrimSpace(text)), "table ")
}

var splitWordEnd = regexp.MustCompile(`\p{L}{2,}[-\x{00ad}]$`)
var splitWordStart = regexp.MustCompile(`^\p{Ll}{2,}`)

func continuesDelimiter(left, right string) bool {
	// A closing delimiter early in the new fragment can continue an expression.
	for _, pair := range [][2]string{{"(", ")"}, {"[", "]"}, {"（", "）"}, {"［", "］"}} {
		end := strings.Index(right, pair[1])
		if end < 0 || end > 40 || strings.Count(left, pair[0]) <= strings.Count(left, pair[1]) {
			continue
		}
		start := strings.Index(right, pair[0])
		if start < 0 || end < start {
			return true
		}
	}
	return false
}

func edgeEvidence(regions []Region, edge readingEdge) (int, []string) {
	a, b := regions[edge.from], regions[edge.to]
	evidence := []string{}
	score := 0
	left, right := strings.TrimSpace(a.Text), strings.TrimSpace(b.Text)
	incomplete := incompleteEnd(left)
	gap := b.Rect.Y - a.Rect.Y - a.Rect.H

	switch edge.kind {
	case "page":
		evidence = append(evidence, "上一页末段与下一页首段")
	case "column":
		evidence = append(evidence, "左栏末段与右栏首段")
	default:
		evidence = append(evidence, "同栏中相邻的两块正文")
	}
	boundary := edge.kind != "same" && a.Rect.Y+a.Rect.H >= .72
	closeLines := edge.kind == "same" && gap <= .022
	if boundary || closeLines {
		score++
	}
	if incomplete {
		score += 2
		evidence = append(evidence, "前块没有明确结束")
	}
	switch {
	case continuesDelimiter(left, right):
		score += 4
		evidence = append(evidence, "后块补上了前块未闭合的引用或括号")
	case splitWordEnd.MatchString(left) && splitWordStart.MatchString(right):
		score += 4
		evidence = append(evidence, "两块边界出现断词和接续字母")
	case incomplete && (strings.HasSuffix(left, ",") || strings.HasSuffix(left, "，")) && (boundary || closeLines):
		score += 2
		evidence = append(evidence, "前块仍在逗号后的同一句中")
	case incomplete && lowercaseStart(right) && (boundary || closeLines):
		score += 2
		evidence = append(evidence, "后块以小写接续前块")
	case incomplete && closeLines && gap <= .015 && horizontalCoverage(a.Rect, b.Rect) > .85:
		score += 2
		evidence = append(evidence, "同栏位置对齐且间隔接近断行")
	}
	if a.Flow != nil && b.Flow != nil && b.Flow.FontX > 0 && b.Flow.Lines > 0 {
		left := b.Rect.X
		for _, r := range regions {
			if r.Page == b.Page && paragraph(r.Kind) && columnBand(r.Rect) == columnBand(b.Rect) && r.Rect.W > .24 && r.Rect.W < .6 {
				left = math.Min(left, r.Rect.X)
			}
		}
		inset := (b.Flow.FirstX - left) / b.Flow.FontX
		if inset < .5 {
			score += 2
			evidence = append(evidence, "后块首行没有明显缩进")
		} else if inset > .85 {
			score -= 3
			evidence = append(evidence, "后块首行有段落缩进")
		}
		if a.Flow.Lines > 1 && (a.Flow.Right-a.Flow.LastRight) < a.Flow.FontX*1.5 {
			score++
			if boundary && !incomplete && inset < .5 {
				score++
			}
			evidence = append(evidence, "前块末行接近栏宽")
		}
		if edge.kind == "same" && a.Flow.Step > 0 {
			gap := (b.Rect.Y - a.Rect.Y - a.Rect.H) / a.Flow.Step
			if gap < .9 {
				score++
				evidence = append(evidence, "两块之间接近正常行距")
			} else if gap > 1.7 {
				score -= 2
				evidence = append(evidence, "两块之间有较大间距")
			}
		}
	}
	return score, evidence
}

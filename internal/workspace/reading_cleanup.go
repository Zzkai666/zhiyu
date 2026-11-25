package workspace

import (
	"regexp"
	"strings"
)

// Older caches measured vertical arXiv stamps as horizontal text.
// Limit recovery to the exact first-page margin stamp with category and date.
var cachedArxivStamp = regexp.MustCompile(`(?i)\s*arxiv:\s*(?:[0-9]{4}\.[0-9]{4,5}|[a-z.-]+/[0-9]{7})(?:v[0-9]+)?\s*\[[a-z0-9 .-]+\]\s+[0-9]{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+[0-9]{4}\s*$`)

func cleanCachedRegion(region Region) Region {
	if region.Page != 1 || !paragraph(region.Kind) || region.Rect.X > .25 || !cachedArxivStamp.MatchString(region.Text) {
		return region
	}
	cleaned := strings.TrimSpace(cachedArxivStamp.ReplaceAllString(region.Text, ""))
	if cleaned != region.Text {
		region.Text = cleaned
		if cleaned == "" {
			region.Kind = "margin"
		}
	}
	return region
}

package workspace

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
)

type Region struct {
	Kind           string       `json:"kind"`
	Rect           Rect         `json:"rect"`
	Text           string       `json:"text"`
	Uncertain      bool         `json:"uncertain,omitempty"`
	LabelUncertain bool         `json:"labelUncertain,omitempty"`
	ID             string       `json:"id,omitempty"`
	Page           int          `json:"page,omitempty"`
	Translate      bool         `json:"translate"`
	Flow           *ReadingFlow `json:"flow,omitempty"`
}
type RegionEdit struct {
	Kind      string `json:"kind,omitempty"`
	Translate *bool  `json:"translate,omitempty"`
}
type Join struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Broken bool   `json:"broken,omitempty"`
}
type ReadingEdits struct {
	Joins    []Join                `json:"joins"`
	Regions  map[string]RegionEdit `json:"regions"`
	Reviewed map[string]bool       `json:"reviewed,omitempty"`
}
type ReadingGroup struct {
	ID               string   `json:"id"`
	Regions          []Region `json:"regions"`
	Text             string   `json:"text"`
	Translate        bool     `json:"translate"`
	Translation      string   `json:"translation,omitempty"`
	Model            string   `json:"model,omitempty"`
	Auto             bool     `json:"auto,omitempty"`
	PriorTranslation string   `json:"priorTranslation,omitempty"`
	legacyID         string
}
type ReadingPlan struct {
	Pages           []int           `json:"pages"`
	Revision        int             `json:"revision"`
	Groups          []ReadingGroup  `json:"groups"`
	Review          []ReadingReview `json:"review"`
	OtherReview     []ReadingReview `json:"otherReview"`
	ConfirmedReview []ReadingReview `json:"confirmedReview"`
}

func regionKind(kind string) bool {
	switch kind {
	case "title", "author", "abstract", "heading", "text", "caption", "figure", "table", "formula", "formula-number", "reference", "margin":
		return true
	}
	return false
}
func textual(kind string) bool {
	switch kind {
	case "title", "abstract", "heading", "text", "caption":
		return true
	}
	return false
}
func paragraph(kind string) bool { return kind == "text" || kind == "abstract" }

func stitch(parts []Region) string {
	result := ""
	for _, region := range parts {
		text := strings.Join(strings.Fields(region.Text), " ")
		if text == "" {
			continue
		}
		if result == "" {
			result = text
			continue
		}
		first := []rune(text)[0]
		// Rejoin only the invisible soft hyphen. Visible hyphens can carry meaning.
		if strings.HasSuffix(result, "\u00ad") {
			result = strings.TrimSuffix(result, "\u00ad") + text
		} else if strings.ContainsRune(",.;:!?)]}", first) {
			result += text
		} else {
			result += " " + text
		}
	}
	return result
}

var openingCitation = regexp.MustCompile(`^\p{Lu}[\p{L}’'\-]+(?:\s+\p{Lu}[\p{L}’'\-]+)?\s+et\s+al\.[\s,(]`)

func autoContinuation(a, b Region, bridgesVisual bool) bool {
	return a.Page+1 == b.Page && a.Rect.Y+a.Rect.H >= .79 && (b.Rect.Y <= .24 || bridgesVisual) && sentenceContinues(a, b)
}

func makeReadingPlan(pages []int, source []Region, edits ReadingEdits, revision int) ReadingPlan {
	regions := slices.Clone(source)
	oldText := map[string]string{}
	for i, r := range regions {
		cleaned := cleanCachedRegion(r)
		if cleaned.Text != r.Text {
			oldText[r.ID] = r.Text
		}
		regions[i] = cleaned
	}
	classifyMetadataFooters(regions)
	classifyAuthorRegions(regions)
	lookup := map[string]int{}
	byPage := map[int][]int{}
	for i := range regions {
		region := &regions[i]
		edit := edits.Regions[region.ID]
		if regionKind(edit.Kind) {
			region.Kind = edit.Kind
			region.LabelUncertain = false
		}
		region.Translate = textual(region.Kind) && strings.TrimSpace(region.Text) != ""
		if edit.Translate != nil {
			region.Translate = *edit.Translate && region.Text != "" && region.Kind != "figure" && region.Kind != "table" && region.Kind != "formula"
		}
		lookup[region.ID] = i
		byPage[region.Page] = append(byPage[region.Page], i)
	}
	next, prev := map[int]int{}, map[int]int{}
	auto := map[int]bool{}
	broken := map[[2]int]bool{}
	manual := map[int]bool{}
	for _, join := range edits.Joins {
		a, okA := lookup[join.From]
		b, okB := lookup[join.To]
		if !okA || !okB || a >= b {
			continue
		}
		if join.Broken {
			broken[[2]int{a, b}] = true
			continue
		}
		if !paragraph(regions[a].Kind) || !paragraph(regions[b].Kind) {
			continue
		}
		if _, exists := next[a]; exists {
			continue
		}
		if _, exists := prev[b]; exists {
			continue
		}
		manual[a] = true
		manual[b] = true
		next[a] = b
		prev[b] = a
	}
	connect := func(a, b int) {
		if manual[a] || manual[b] || broken[[2]int{a, b}] || edits.Reviewed[reviewKey(regions[a].ID, regions[b].ID)] {
			return
		}
		if _, exists := next[a]; exists {
			return
		}
		if _, exists := prev[b]; exists {
			return
		}
		next[a] = b
		prev[b] = a
		auto[a] = true
	}
	for _, p := range pages {
		floatingContinuations(regions, byPage[p], connect)
		if a, b, ok := columnContinuation(regions, byPage[p]); ok {
			connect(a, b)
		}
	}

	for _, p := range pages {
		end, start := -1, -1
		for _, i := range byPage[p] {
			if regions[i].Uncertain {
				continue
			}
			if paragraph(regions[i].Kind) {
				end = i
			} else if regions[i].Kind == "heading" || regions[i].Kind == "title" {
				end = -1
			}
		}
		floatingBottom := 0.0
		for _, i := range byPage[p+1] {
			if regions[i].Uncertain {
				continue
			}
			if regions[i].Kind == "heading" || regions[i].Kind == "title" {
				break
			}
			if paragraph(regions[i].Kind) {
				start = i
				break
			}
			if regions[i].Kind == "figure" || regions[i].Kind == "table" || regions[i].Kind == "formula" {
				area := regions[i].Rect
				if area.H >= .065 {
					floatingBottom = max(floatingBottom, area.Y+area.H)
				}
			} else if regions[i].Kind == "caption" && floatingBottom > 0 && regions[i].Rect.Y <= floatingBottom+.07 {
				floatingBottom = max(floatingBottom, regions[i].Rect.Y+regions[i].Rect.H)
			}
		}
		if end < 0 || start < 0 || broken[[2]int{end, start}] || !autoContinuation(regions[end], regions[start],
			floatingBottom > 0 && regions[start].Rect.Y >= floatingBottom-.04 && regions[start].Rect.Y <= floatingBottom+.18) {
			continue
		}
		connect(end, start)
	}
	plan := ReadingPlan{Pages: pages, Revision: revision, Groups: []ReadingGroup{}}
	for i := range regions {
		if _, isTail := prev[i]; isTail {
			continue
		}
		group := ReadingGroup{}
		for j := i; ; {
			part := regions[j]
			group.Regions = append(group.Regions, part)
			group.Translate = group.Translate || part.Translate
			group.Auto = group.Auto || auto[j]
			n, ok := next[j]
			if !ok {
				break
			}
			j = n
		}
		if len(group.Regions) > 1 {
			for j := range group.Regions {
				group.Regions[j].Translate = group.Translate
			}
		}
		group.Text = stitch(group.Regions)
		group.ID = regionFingerprint(group.Regions)
		legacy := slices.Clone(group.Regions)
		changed := false
		for i := range legacy {
			if text, ok := oldText[legacy[i].ID]; ok {
				legacy[i].Text = text
				changed = true
			}
		}
		if changed {
			group.legacyID = regionFingerprint(legacy)
		}
		plan.Groups = append(plan.Groups, group)
	}
	plan.Review, plan.OtherReview, plan.ConfirmedReview = reviewContinuations(regions, next, prev, manual, broken, edits)
	return plan
}

func regionFingerprint(regions []Region) string {
	parts := slices.Clone(regions)
	for i := range parts {
		parts[i].Flow = nil
	}
	data, _ := json.Marshal(parts)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (w *Workspace) readReadingPlan(ctx context.Context, paper string) (ReadingPlan, ReadingEdits, error) {
	return readReadingPlanFrom(ctx, w.db, paper)
}
func readReadingPlanFrom(ctx context.Context, reader exportReader, paper string) (ReadingPlan, ReadingEdits, error) {
	edits := ReadingEdits{Joins: []Join{}, Regions: map[string]RegionEdit{}}
	var active string
	if err := reader.QueryRowContext(ctx, "SELECT id FROM papers WHERE id=? AND deleted_at IS NULL", paper).Scan(&active); err != nil {
		return ReadingPlan{}, edits, err
	}
	rows, err := reader.QueryContext(ctx, "SELECT page,blocks FROM reading_pages WHERE paper_id=? ORDER BY page", paper)
	if err != nil {
		return ReadingPlan{}, edits, err
	}
	pages := []int{}
	regions := []Region{}
	for rows.Next() {
		var page int
		var data string
		var blocks []Region
		if err = rows.Scan(&page, &data); err == nil {
			err = json.Unmarshal([]byte(data), &blocks)
		}
		if err != nil {
			rows.Close()
			return ReadingPlan{}, edits, err
		}
		pages = append(pages, page)
		for i := range blocks {
			blocks[i].ID = fmt.Sprintf("p%d-b%d", page, i+1)
			blocks[i].Page = page
		}
		regions = append(regions, blocks...)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return ReadingPlan{}, edits, err
	}
	var raw string
	var rev int
	err = reader.QueryRowContext(ctx, "SELECT revision,edits FROM reading_edits WHERE paper_id=?", paper).Scan(&rev, &raw)
	if err == nil {
		err = json.Unmarshal([]byte(raw), &edits)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ReadingPlan{}, edits, err
	}
	plan := makeReadingPlan(pages, regions, edits, rev)
	indexed := map[string]*ReadingGroup{}
	legacy := map[string]*ReadingGroup{}
	for i := range plan.Groups {
		g := &plan.Groups[i]
		indexed[g.ID] = g
		if g.legacyID != "" {
			legacy[g.legacyID] = g
		}
	}
	rows, err = reader.QueryContext(ctx, "SELECT fingerprint,text,model FROM reading_translations WHERE paper_id=?", paper)
	if err != nil {
		return ReadingPlan{}, edits, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, text, model string
		if err = rows.Scan(&id, &text, &model); err != nil {
			return ReadingPlan{}, edits, err
		}
		if g := indexed[id]; g != nil {
			g.Translation = text
			g.Model = model
		} else if g := legacy[id]; g != nil {
			g.PriorTranslation = text
		}
	}
	return plan, edits, rows.Err()
}

func (w *Workspace) readingPlan(rw http.ResponseWriter, r *http.Request) {
	w.readerLock.Lock()
	defer w.readerLock.Unlock()
	plan, _, err := w.readReadingPlan(r.Context(), r.PathValue("id"))
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, plan)
}

func (w *Workspace) saveReadingPage(rw http.ResponseWriter, r *http.Request) {
	page := pageNumber(r)
	var regions []Region
	if !readJSON(rw, r, 2<<20, &regions) {
		return
	}
	if page < 1 || page > 100000 || regions == nil || len(regions) > 3000 {
		fail(rw, 400, "页码或版面区块无效")
		return
	}
	for i := range regions {
		region := &regions[i]
		if !regionKind(region.Kind) || !region.Rect.valid() || len(region.Text) > 120000 || region.Flow != nil && !region.Flow.valid() {
			fail(rw, 400, "版面区块无效")
			return
		}
		region.ID = ""
		region.Page = 0
		region.Translate = false
		if region.Kind == "figure" || region.Kind == "table" || region.Kind == "formula" {
			region.Text = ""
		}
	}
	raw, _ := json.Marshal(regions)
	w.readerLock.Lock()
	defer w.readerLock.Unlock()
	_, err := w.db.ExecContext(r.Context(), `INSERT INTO reading_pages(paper_id,page,blocks)
  SELECT id,?,? FROM papers WHERE id=? AND deleted_at IS NULL ON CONFLICT DO NOTHING`, page, string(raw), r.PathValue("id"))
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, true)
}

func (w *Workspace) editReading(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Revision  int      `json:"revision"`
		Action    string   `json:"action"`
		First     string   `json:"first"`
		Selected  []string `json:"selected,omitempty"`
		Second    string   `json:"second,omitempty"`
		Kind      string   `json:"kind,omitempty"`
		Translate *bool    `json:"translate,omitempty"`
	}
	if !readJSON(rw, r, 8192, &input) {
		return
	}
	w.readerLock.Lock()
	defer w.readerLock.Unlock()
	paper := r.PathValue("id")
	plan, edits, err := w.readReadingPlan(r.Context(), paper)
	if err != nil {
		databaseError(rw, err)
		return
	}
	if input.Revision != plan.Revision {
		fail(rw, 409, "段落已修改，请刷新后重试")
		return
	}
	var first *ReadingGroup
	if input.Action != "join" && input.Action != "keep" && input.Action != "review-all" && input.Action != "recheck" {
		for i := range plan.Groups {
			group := &plan.Groups[i]
			for _, part := range group.Regions {
				if part.ID == input.First {
					first = group
				}
			}
		}
		if first == nil {
			fail(rw, 404, "找不到所选区块")
			return
		}
	}

	if edits.Regions == nil {
		edits.Regions = map[string]RegionEdit{}
	}
	switch input.Action {
	case "join":
		selected := input.Selected
		if len(selected) == 0 {
			selected = []string{input.First, input.Second}
		}
		joined, ok := joinSelected(plan, edits, selected)
		if !ok {
			fail(rw, 400, "请选择同页或连续页面上的多个正文区块")
			return
		}
		edits = joined

	case "keep", "review-all", "recheck":
		if edits.Reviewed == nil {
			edits.Reviewed = map[string]bool{}
		}
		matched := input.Action == "review-all"
		candidates := plan.Review
		if input.Action == "keep" {
			candidates = append(slices.Clone(plan.Review), plan.OtherReview...)
		}
		if input.Action == "recheck" {
			candidates = plan.ConfirmedReview
		}
		keys := reviewDecisionKeys(candidates, input.First, input.Second, input.Selected, input.Action == "review-all")
		matched = matched || len(keys) > 0
		if !matched {
			fail(rw, 409, "核对项已变化，请刷新后重试")
			return
		}
		for _, key := range keys {
			if input.Action == "recheck" {
				delete(edits.Reviewed, key)
			} else {
				edits.Reviewed[key] = true
			}
		}
	case "split":
		if len(first.Regions) < 2 {
			fail(rw, 400, "该区块无需拆分")
			return
		}
		for i := 1; i < len(first.Regions); i++ {
			edits.Joins = setJoin(edits.Joins, first.Regions[i-1].ID, first.Regions[i].ID, true)
		}
	case "split-edge", "correct-region":
		parts := first.Regions
		index := slices.IndexFunc(parts, func(part Region) bool { return part.ID == input.First })
		if input.Action == "split-edge" {
			neighbor := slices.IndexFunc(parts, func(part Region) bool { return part.ID == input.Second })
			if neighbor < 0 || neighbor != index-1 && neighbor != index+1 {
				fail(rw, 409, "这两块已不是同一段的相邻区块")
				return
			}
			edits.Joins = setJoin(edits.Joins, parts[min(index, neighbor)].ID, parts[max(index, neighbor)].ID, true)
			break
		}
		if !regionKind(input.Kind) {
			fail(rw, 400, "请选择有效的区块类别")
			return
		}
		target := parts[index]
		if target.Kind != input.Kind {
			// Detach only the corrected fragment. Other edges of the old paragraph stay intact.
			if index > 0 {
				edits.Joins = setJoin(edits.Joins, parts[index-1].ID, target.ID, true)
			}
			if index+1 < len(parts) {
				edits.Joins = setJoin(edits.Joins, target.ID, parts[index+1].ID, true)
			}
		}
		edit := edits.Regions[target.ID]
		edit.Kind = input.Kind
		edit.Translate = input.Translate
		if input.Kind == "margin" || input.Kind == "figure" || input.Kind == "table" ||
			input.Kind == "formula" || input.Kind == "formula-number" {
			no := false
			edit.Translate = &no
		}
		edits.Regions[target.ID] = edit
	case "region":
		if input.Kind != "" && !regionKind(input.Kind) {
			fail(rw, 400, "类别无效")
			return
		}
		if input.Kind != "" && len(first.Regions) > 1 && !paragraph(input.Kind) {
			fail(rw, 400, "请先拆开跨区域段落")
			return
		}
		for _, p := range first.Regions {
			edit := edits.Regions[p.ID]
			if p.ID == input.First && input.Kind != "" {
				edit.Kind = input.Kind
			}
			if input.Translate != nil {
				edit.Translate = input.Translate
			}
			edits.Regions[p.ID] = edit
		}
	default:
		fail(rw, 400, "未知的区块操作")
		return
	}
	data, _ := json.Marshal(edits)
	_, err = w.db.ExecContext(r.Context(), `INSERT INTO reading_edits(paper_id,revision,edits) VALUES(?,?,?)
 ON CONFLICT(paper_id) DO UPDATE SET revision=excluded.revision,edits=excluded.edits`, paper, plan.Revision+1, string(data))
	if err != nil {
		databaseError(rw, err)
		return
	}
	next, _, err := w.readReadingPlan(r.Context(), paper)
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, next)
}

func regionOrder(id string) int {
	var page, index int
	_, _ = fmt.Sscanf(id, "p%d-b%d", &page, &index)
	return index
}
func setJoin(joins []Join, a, b string, broken bool) []Join {
	for i := range joins {
		if joins[i].From == a && joins[i].To == b {
			joins[i].Broken = broken
			return joins
		}
	}
	return append(joins, Join{a, b, broken})
}

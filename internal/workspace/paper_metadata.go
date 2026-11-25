package workspace

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

func matchingPaperTitle(a, b string) bool {
	words := func(s string) []string {
		return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) })
	}
	aa, bb := words(a), words(b)
	if len(aa) < 4 || len(bb) < 4 {
		return false
	}
	set := map[string]bool{}
	for _, s := range aa {
		set[s] = true
	}
	n := 0
	for _, s := range bb {
		if set[s] {
			n++
		}
	}
	return float64(n)/float64(min(len(aa), len(bb))) >= .55
}

type PaperMetadata struct {
	Arxiv     string `json:"arxiv"`
	URL       string `json:"url"`
	PDF       string `json:"pdf"`
	Journal   string `json:"journal"`
	Abstract  string `json:"abstract"`
	Keywords  string `json:"keywords"`
	Source    string `json:"source"`
	Status    string `json:"status"`
	UpdatedAt string `json:"updatedAt"`
	Error     string `json:"error,omitempty"`
}

var embeddedDOI = regexp.MustCompile(`(?i)\b10\.[0-9]{4,9}/[^\s<>"{}]+`)
var embeddedArxiv = regexp.MustCompile(`(?i)(?:arxiv[:\s/]+|arxiv\.org/(?:abs|pdf)/)([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)`)

func (w *Workspace) enrichPaperMetadata(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Revision                       int
		Title, Authors, Text, Keywords string
		Year                           int
		Online                         bool
	}
	if !readJSON(rw, r, 96<<10, &input) {
		return
	}
	if len(input.Title) > 2000 || len(input.Authors) > 3000 || len(input.Text) > 80000 {
		fail(rw, 400, "元数据内容过长")
		return
	}
	before, err := scanPaper(w.db.QueryRowContext(r.Context(), paperSelect+" WHERE p.id=? AND p.deleted_at IS NULL", r.PathValue("id")))
	if err != nil {
		databaseError(rw, err)
		return
	}
	if before.Revision != input.Revision {
		fail(rw, 409, "文献信息已更新，请重新核对")
		return
	}
	meta := before.Metadata
	meta.Status = "local"
	meta.Source = "PDF 内嵌信息与首页"
	meta.Error = ""
	meta.UpdatedAt = now()
	title, authors, doi, year := strings.TrimSpace(input.Title), strings.TrimSpace(input.Authors), before.DOI, input.Year
	if input.Year < 1800 || input.Year > time.Now().Year()+2 {
		year = 0
	}
	if hit := embeddedArxiv.FindStringSubmatch(input.Text + " " + before.Filename); len(hit) > 1 {
		meta.Arxiv = hit[1]
	}
	if meta.Arxiv == "" {
		candidate := strings.TrimSuffix(before.Filename, ".pdf")
		if arxivPattern.MatchString(candidate) {
			meta.Arxiv = candidate
		}
	}
	if doi == "" {
		doi = strings.TrimRight(embeddedDOI.FindString(input.Text), ".,;)")
	}
	if len(doi) > 512 {
		doi = ""
	}
	meta.Keywords = cleanOnline(input.Keywords, 2000)
	abstract := regexp.MustCompile(`(?is)\babstract\s*[:—-]?\s+(.{100,}?)(?:\s+index terms|\s+keywords|\s+i\.\s+introduction|\s+1\.?\s+introduction)`).FindStringSubmatch(input.Text)
	if len(abstract) > 1 {
		meta.Abstract = cleanOnline(abstract[1], 12000)
	}
	if meta.Arxiv != "" {
		meta.URL = "https://arxiv.org/abs/" + meta.Arxiv
		meta.PDF = "https://arxiv.org/pdf/" + meta.Arxiv
	}
	if input.Online && (meta.Arxiv != "" || doi != "") {
		ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
		defer cancel()
		var rows []ImportCandidate
		if meta.Arxiv != "" {
			rows, err = lookupArxiv(ctx, meta.Arxiv)
		} else {
			rows, err = lookupCrossref(ctx, doi, true)
		}
		if err == nil && len(rows) > 0 {
			c := rows[0]
			if title != "" && !matchingPaperTitle(title, c.Title) {
				meta.Error = "在线条目与本地题目不一致，保留本地结果"
			} else {
				title, authors, doi, year = c.Title, c.Authors, c.DOI, c.Year
				if doi == "" {
					doi = before.DOI
				}
				meta.URL = c.Source
				meta.PDF = c.PDF
				if c.Journal != "" {
					meta.Journal = c.Journal
				}
				if len(c.Abstract) > 150 && !strings.HasPrefix(strings.ToLower(c.Abstract), "abstract page for") {
					meta.Abstract = c.Abstract
				}
				meta.Source = "在线标识符核对"
				meta.Status = "verified"
			}
		} else {
			meta.Error = "在线信息暂不可用，已保留本地提取结果"
		}
	}
	if year == 0 && len(meta.Arxiv) >= 4 {
		if n, e := strconv.Atoi(meta.Arxiv[:2]); e == nil && n >= 7 && 2000+n <= time.Now().Year() {
			year = 2000 + n
			meta.Source += "（预印本年份据 arXiv 编号）"
		}
	}
	if meta.URL == "" && doi != "" {
		meta.URL = "https://doi.org/" + doi
	}
	// A later manual rename is never overwritten by automatic recognition.
	if title == "" || len(title) > 1000 || before.Title != before.Filename && before.Title != "" && !arxivPattern.MatchString(before.Title) {
		title = before.Title
	}
	if authors == "" {
		authors = before.Authors
	}
	if year == 0 {
		year = before.Year
	}
	raw, _ := json.Marshal(meta)
	result, err := w.db.ExecContext(r.Context(), `UPDATE papers SET title=?,authors=?,year=?,doi=?,metadata=?,revision=revision+1 WHERE id=? AND revision=? AND deleted_at IS NULL`, title, authors, year, doi, string(raw), before.ID, before.Revision)
	if err != nil {
		databaseError(rw, err)
		return
	}
	if n, _ := result.RowsAffected(); n != 1 {
		fail(rw, 409, "文献信息在核对期间发生变化，未覆盖")
		return
	}
	next, err := scanPaper(w.db.QueryRowContext(r.Context(), paperSelect+" WHERE p.id=?", before.ID))
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, next)
}

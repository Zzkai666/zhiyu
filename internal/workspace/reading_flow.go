package workspace

import (
	"encoding/json"
	"fmt"
	"net/http"
)

type ReadingFlow struct {
	Version   int     `json:"version"`
	Lines     int     `json:"lines"`
	FirstX    float64 `json:"firstX"`
	LastRight float64 `json:"lastRight"`
	Left      float64 `json:"left"`
	Right     float64 `json:"right"`
	FontX     float64 `json:"fontX"`
	Step      float64 `json:"step"`
}

func (f ReadingFlow) valid() bool {
	return f.Version == 1 && f.Lines >= 0 && f.Lines <= 1000 && f.FirstX >= 0 && f.FirstX <= 1 &&
		f.LastRight >= 0 && f.LastRight <= 1 && f.Left >= 0 && f.Right >= f.Left && f.Right <= 1 &&
		f.FontX >= 0 && f.FontX <= .3 && f.Step >= 0 && f.Step <= .5
}

func (w *Workspace) saveReadingFlow(rw http.ResponseWriter, r *http.Request) {
	var items []struct {
		ID   string      `json:"id"`
		Rect Rect        `json:"rect"`
		Flow ReadingFlow `json:"flow"`
	}
	if !readJSON(rw, r, 2<<20, &items) {
		return
	}
	page := pageNumber(r)
	if page < 1 || len(items) == 0 || len(items) > 3000 {
		fail(rw, 400, "文字行信息无效")
		return
	}
	w.readerLock.Lock()
	defer w.readerLock.Unlock()
	var raw string
	if err := w.db.QueryRowContext(r.Context(), `SELECT blocks FROM reading_pages WHERE paper_id=? AND page=?
 AND EXISTS(SELECT 1 FROM papers WHERE id=reading_pages.paper_id AND deleted_at IS NULL)`, r.PathValue("id"), page).Scan(&raw); err != nil {
		databaseError(rw, err)
		return
	}
	var regions []Region
	if err := json.Unmarshal([]byte(raw), &regions); err != nil {
		databaseError(rw, err)
		return
	}
	indices := map[string]int{}
	for i := range regions {
		indices[fmt.Sprintf("p%d-b%d", page, i+1)] = i
	}
	seen := map[string]bool{}
	for _, item := range items {
		index, ok := indices[item.ID]
		if !ok || seen[item.ID] || regions[index].Rect != item.Rect || !item.Flow.valid() {
			fail(rw, 409, "区块或文字行信息已变化，请重新读取")
			return
		}
		seen[item.ID] = true
		value := item.Flow
		regions[index].Flow = &value
	}
	encoded, _ := json.Marshal(regions)
	if _, err := w.db.ExecContext(r.Context(), "UPDATE reading_pages SET blocks=? WHERE paper_id=? AND page=?", string(encoded), r.PathValue("id"), page); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, true)
}

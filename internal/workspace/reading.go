package workspace

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

type Rect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

func (r Rect) valid() bool {
	return r.X >= 0 && r.Y >= 0 && r.W > 0 && r.H > 0 && r.X+r.W <= 1.00001 && r.Y+r.H <= 1.00001
}

type Mark struct {
	Content  string  `json:"content,omitempty"`
	ID       string  `json:"id"`
	Page     int     `json:"page"`
	Kind     string  `json:"kind"`
	Color    string  `json:"color"`
	Quote    string  `json:"quote"`
	Rects    []Rect  `json:"rects"`
	Comment  string  `json:"comment,omitempty"`
	Points   []Point `json:"points,omitempty"`
	Size     float64 `json:"size"`
	Width    float64 `json:"width"`
	Revision int     `json:"revision"`
}

func (w *Workspace) listMarks(rw http.ResponseWriter, r *http.Request) {
	marks, err := readMarksFrom(r.Context(), w.db, r.PathValue("id"))
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, marks)
}
func readMarksFrom(ctx context.Context, reader exportReader, paper string) ([]Mark, error) {
	rows, err := reader.QueryContext(ctx, "SELECT id,page,kind,color,quote,rects,comment,points,size,width,revision,content FROM marks WHERE paper_id=? ORDER BY page,created_at", paper)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	marks := []Mark{}
	for rows.Next() {
		var mark Mark
		var rects, points string
		if err := rows.Scan(&mark.ID, &mark.Page, &mark.Kind, &mark.Color, &mark.Quote, &rects, &mark.Comment, &points, &mark.Size, &mark.Width, &mark.Revision, &mark.Content); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(rects), &mark.Rects); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(points), &mark.Points); err != nil {
			return nil, err
		}
		marks = append(marks, mark)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return marks, nil
}

func (w *Workspace) createMark(rw http.ResponseWriter, r *http.Request) {
	var mark Mark
	if !readJSON(rw, r, 512<<10, &mark) {
		return
	}
	if mark.Kind == "highlight" || mark.Kind == "underline" || mark.Kind == "bookmark" {
		mark.Comment = ""
	}
	if mark.Size == 0 {
		mark.Size = 14
	}
	if mark.Width == 0 {
		mark.Width = 2
	}
	if !validMark(mark) {
		fail(rw, 400, "标记范围无效")
		return
	}
	for _, rect := range mark.Rects {
		if !rect.valid() {
			fail(rw, 400, "标记坐标超出原页")
			return
		}
	}
	if mark.Rects == nil {
		mark.Rects = []Rect{}
	}
	if mark.Points == nil {
		mark.Points = []Point{}
	}
	points, _ := json.Marshal(mark.Points)
	rects, _ := json.Marshal(mark.Rects)
	mark.ID = newID()
	res, err := w.db.ExecContext(r.Context(), `INSERT INTO marks(id,paper_id,page,kind,color,quote,rects,created_at,comment,points,size,width,content)
        SELECT ?,id,?,?,?,?,?,?,?,?,?,?,? FROM papers WHERE id=? AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
		mark.ID, mark.Page, mark.Kind, mark.Color, mark.Quote, string(rects), now(), mark.Comment, string(points), mark.Size, mark.Width, mark.Content, r.PathValue("id"))
	if err != nil {
		databaseError(rw, err)
		return
	}
	if count, _ := res.RowsAffected(); count != 1 {
		fail(rw, 409, "书签已存在或文献不可用")
		return
	}
	mark.Revision = 1
	respond(rw, 201, mark)
}

func (w *Workspace) commentMark(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Comment string `json:"comment"`
	}
	if !readJSON(rw, r, 32<<10, &input) {
		return
	}
	if len(input.Comment) > 12000 {
		fail(rw, 400, "批注超过长度限制")
		return
	}
	res, err := w.db.ExecContext(r.Context(), `UPDATE marks SET comment=?,revision=revision+1 WHERE paper_id=? AND id=? AND kind!='bookmark'
		AND EXISTS (SELECT 1 FROM papers WHERE id=marks.paper_id AND deleted_at IS NULL)`,
		input.Comment, r.PathValue("id"), r.PathValue("mark"))
	if err != nil {
		databaseError(rw, err)
		return
	}
	if count, _ := res.RowsAffected(); count != 1 {
		fail(rw, 404, "这条标记已不存在")
		return
	}
	respond(rw, 200, input)
}

func (w *Workspace) removeMark(rw http.ResponseWriter, r *http.Request) {
	_, err := w.db.ExecContext(r.Context(), "DELETE FROM marks WHERE paper_id=? AND id=?", r.PathValue("id"), r.PathValue("mark"))
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, true)
}

type Block struct {
	Kind      string `json:"kind"`
	Text      string `json:"text"`
	Rect      Rect   `json:"rect"`
	Uncertain bool   `json:"uncertain,omitempty"`
}

func parseKey(r *http.Request) (int, string, bool) {
	page, engine := pageNumber(r), r.PathValue("engine")
	return page, engine, page > 0 && page <= 100000 && (engine == "native" || engine == "layout-v2")
}

func (w *Workspace) readParse(rw http.ResponseWriter, r *http.Request) {
	page, engine, ok := parseKey(r)
	if !ok {
		fail(rw, 400, "解析来源无效")
		return
	}
	var raw string
	var revision int
	err := w.db.QueryRowContext(r.Context(), `SELECT blocks,revision FROM page_parses
        WHERE paper_id=? AND page=? AND engine=? ORDER BY revision DESC LIMIT 1`, r.PathValue("id"), page, engine).Scan(&raw, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		respond(rw, 200, map[string]any{"blocks": nil, "revision": 0})
		return
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, map[string]any{"blocks": json.RawMessage(raw), "revision": revision})
}

func (w *Workspace) saveParse(rw http.ResponseWriter, r *http.Request) {
	page, engine, ok := parseKey(r)
	if !ok {
		fail(rw, 400, "解析来源无效")
		return
	}
	var blocks []Block
	if !readJSON(rw, r, 2<<20, &blocks) {
		return
	}
	if blocks == nil || len(blocks) > 3000 {
		fail(rw, 400, "解析块数量无效")
		return
	}
	for _, block := range blocks {
		if !block.Rect.valid() || len(block.Text) > 100000 || (block.Kind != "text" && block.Kind != "title" &&
			block.Kind != "caption" && block.Kind != "figure" && block.Kind != "table" && block.Kind != "formula") {
			fail(rw, 400, "解析块内容无效")
			return
		}
	}
	data, _ := json.Marshal(blocks)
	id := r.PathValue("id")
	var revision int
	err := w.db.QueryRowContext(r.Context(), `INSERT INTO page_parses(paper_id,page,engine,blocks,created_at,revision)
        SELECT id,?,?,?,?,coalesce((SELECT max(revision) FROM page_parses WHERE paper_id=papers.id AND page=? AND engine=?),0)+1
        FROM papers WHERE id=? AND deleted_at IS NULL RETURNING revision`, page, engine, string(data), now(), page, engine, id).Scan(&revision)
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 201, map[string]int{"revision": revision})
}

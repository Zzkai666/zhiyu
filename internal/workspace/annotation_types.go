package workspace

import (
	"encoding/json"
	"net/http"
	"strings"
)

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func validMarkColor(color string) bool {
	return strings.Contains("|amber|red|green|blue|purple|pink|orange|gray|", "|"+color+"|")
}
func validMark(mark Mark) bool {
	if mark.Page < 1 || mark.Page > 100000 || !validMarkColor(mark.Color) || len(mark.Quote) > 32000 || len(mark.Comment) > 12000 || len(mark.Content) > 12000 || len(mark.Rects) > 250 || len(mark.Points) > 10000 {
		return false
	}
	if mark.Size == 0 {
		mark.Size = 14
	}
	if mark.Width == 0 {
		mark.Width = 2
	}
	if mark.Size < 8 || mark.Size > 48 || mark.Width < 1 || mark.Width > 12 {
		return false
	}
	switch mark.Kind {
	case "bookmark":
		return len(mark.Rects) == 0 && len(mark.Points) == 0
	case "highlight", "underline":
		if mark.Quote == "" || len(mark.Rects) == 0 {
			return false
		}
	case "note", "text", "area":
		if len(mark.Rects) != 1 {
			return false
		}
	case "ink":
		if len(mark.Points) < 2 || len(mark.Rects) != 1 {
			return false
		}
	default:
		return false
	}
	for _, rect := range mark.Rects {
		if !rect.valid() {
			return false
		}
	}
	for _, point := range mark.Points {
		if !(point.X >= 0 && point.X <= 1 && point.Y >= 0 && point.Y <= 1) {
			return false
		}
	}
	return true
}
func (w *Workspace) updateAnnotation(rw http.ResponseWriter, r *http.Request) {
	var mark Mark
	if !readJSON(rw, r, 512<<10, &mark) {
		return
	}
	if mark.Revision < 1 || !validMark(mark) {
		fail(rw, 400, "标注内容或坐标无效")
		return
	}
	raw, _ := json.Marshal(mark.Rects)
	points, _ := json.Marshal(mark.Points)
	res, err := w.db.ExecContext(r.Context(), `UPDATE marks SET color=?,quote=?,rects=?,comment=?,points=?,size=?,width=?,content=?,revision=revision+1
 WHERE paper_id=? AND id=? AND revision=? AND kind=? AND page=? AND EXISTS(SELECT 1 FROM papers WHERE id=marks.paper_id AND deleted_at IS NULL)`,
		mark.Color, mark.Quote, string(raw), mark.Comment, string(points), mark.Size, mark.Width, mark.Content, r.PathValue("id"), r.PathValue("mark"), mark.Revision, mark.Kind, mark.Page)
	if err != nil {
		databaseError(rw, err)
		return
	}
	if n, _ := res.RowsAffected(); n != 1 {
		fail(rw, 409, "标注已更新，请重新打开后编辑")
		return
	}
	mark.ID = r.PathValue("mark")
	mark.Revision++
	respond(rw, 200, mark)
}

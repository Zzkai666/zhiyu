package workspace

import (
	"database/sql"
	"net/http"
	"strings"
	"time"
)

type LifeEntry struct {
	ID       string  `json:"id"`
	Kind     string  `json:"kind"`
	Title    string  `json:"title"`
	Day      string  `json:"day"`
	Quantity float64 `json:"quantity"`
	Minutes  int     `json:"minutes"`
	Detail   string  `json:"detail"`
	Deleted  bool    `json:"deleted"`
	Revision int     `json:"revision"`
}

func (w *Workspace) listLife(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), `SELECT id,kind,title,day,quantity,minutes,detail,deleted,revision FROM life_entries ORDER BY day DESC,id`)
	list(rw, rows, err, func(row *sql.Rows, v *LifeEntry) error {
		return row.Scan(&v.ID, &v.Kind, &v.Title, &v.Day, &v.Quantity, &v.Minutes, &v.Detail, &v.Deleted, &v.Revision)
	})
}
func (w *Workspace) saveLife(rw http.ResponseWriter, r *http.Request) {
	var v LifeEntry
	if !readJSON(rw, r, 64<<10, &v) {
		return
	}
	v.Title = strings.TrimSpace(v.Title)
	if !validTitle(v.Title) || !actualDay(v.Day) || v.Minutes < 0 || v.Minutes > 1440 || v.Quantity < 0 || v.Quantity > 10000 ||
		len(v.Detail) > 16000 || (v.Kind != "habit" && v.Kind != "cardio" && v.Kind != "strength") ||
		(v.Kind != "habit" && v.Minutes == 0) || (v.Kind == "strength" && v.Quantity != 0) {
		fail(rw, 400, "请核对实际日期、名称、用时和数量")
		return
	}
	var err error
	if r.Method == "POST" {
		v.ID, v.Revision, v.Deleted = newID(), 1, false
		_, err = w.db.ExecContext(r.Context(), `INSERT INTO life_entries(id,kind,title,day,quantity,minutes,detail) VALUES(?,?,?,?,?,?,?)`,
			v.ID, v.Kind, v.Title, v.Day, v.Quantity, v.Minutes, v.Detail)
	} else {
		v.ID = r.PathValue("id")
		err = w.db.QueryRowContext(r.Context(), `UPDATE life_entries SET title=?,day=?,quantity=?,minutes=?,detail=?,deleted=?,revision=revision+1
            WHERE id=? AND kind=? AND revision=? RETURNING revision`, v.Title, v.Day, v.Quantity, v.Minutes, v.Detail, v.Deleted, v.ID, v.Kind, v.Revision).Scan(&v.Revision)
	}
	writeResult(rw, r, err, v)
}
func (w *Workspace) updateWater(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Day   string `json:"day"`
		Delta int    `json:"delta"`
	}
	if !readJSON(rw, r, 1024, &input) {
		return
	}
	if input.Day != time.Now().Format("2006-01-02") || (input.Delta != 1 && input.Delta != -1) {
		fail(rw, 400, "只能增减今天的饮水记录")
		return
	}
	var v LifeEntry
	v.Day, v.Kind, v.Title = input.Day, "water", "饮水"
	initial := max(0, input.Delta)
	err := w.db.QueryRowContext(r.Context(), `INSERT INTO life_entries(id,kind,title,day,quantity,minutes,detail) VALUES(?,'water','饮水',?,?,0,'')
        ON CONFLICT(day) WHERE kind='water' DO UPDATE SET quantity=min(24,max(0,quantity+?)),revision=revision+1
        RETURNING id,quantity,revision`, newID(), v.Day, initial, input.Delta).Scan(&v.ID, &v.Quantity, &v.Revision)
	writeResult(rw, r, err, v)
}

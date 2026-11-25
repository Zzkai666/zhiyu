package workspace

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"time"
)

type PlannerItem struct {
	Agenda
	SeriesID           string `json:"seriesId,omitempty"`
	OccurrenceDay      string `json:"occurrenceDay,omitempty"`
	OccurrenceRevision int    `json:"occurrenceRevision"`
	SeriesRevision     int    `json:"seriesRevision"`
}
type PlannerBoard struct {
	Day         string        `json:"day"`
	Important   []PlannerItem `json:"important"`
	Today       []PlannerItem `json:"today"`
	Overdue     []PlannerItem `json:"overdue"`
	Later       []PlannerItem `json:"later"`
	Unscheduled []PlannerItem `json:"unscheduled"`
	Skipped     []PlannerItem `json:"skipped"`
	Series      []Agenda      `json:"series"`
}
type occurrence struct {
	done, deleted bool
	revision      int
}

func occurrenceID(series, day string) string {
	sum := sha256.Sum256([]byte("planner/" + series + "/" + day))
	return hex.EncodeToString(sum[:16])
}
func repeatsOn(a Agenda, day string) bool {
	if a.Repeat == "none" || a.Paused || day < a.Day || (a.RepeatUntil != "" && day > a.RepeatUntil) {
		return false
	}
	d, e := time.Parse("2006-01-02", day)
	if e != nil {
		return false
	}
	return a.Repeat == "daily" || (a.Repeat == "weekly" && (a.RepeatDays&(1<<((int(d.Weekday())+6)%7))) != 0)
}
func plannerDate(a Agenda) string {
	if a.Deadline != "" {
		return a.Deadline
	}
	return a.Day
}
func deriveItem(a Agenda, day string, o occurrence) PlannerItem {
	return PlannerItem{Agenda: Agenda{ID: occurrenceID(a.ID, day), Kind: a.Kind, Title: a.Title, Detail: a.Detail, Day: day, Start: a.Start, End: a.End, ProjectID: a.ProjectID, PaperID: a.PaperID, PaperPage: a.PaperPage, Done: o.done, Deleted: o.deleted, Revision: o.revision, Repeat: a.Repeat, RepeatDays: a.RepeatDays, RepeatUntil: a.RepeatUntil, Paused: a.Paused}, SeriesID: a.ID, OccurrenceDay: day, OccurrenceRevision: o.revision, SeriesRevision: a.Revision}
}
func (w *Workspace) readPlanner(ctx context.Context, day string) (PlannerBoard, error) {
	b := PlannerBoard{Day: day, Important: []PlannerItem{}, Today: []PlannerItem{}, Overdue: []PlannerItem{}, Later: []PlannerItem{}, Unscheduled: []PlannerItem{}, Skipped: []PlannerItem{}, Series: []Agenda{}}
	rows, e := w.db.QueryContext(ctx, agendaSelect+" WHERE deleted_at IS NULL AND (done=0 OR day=?) ORDER BY day,start,updated_at,id", day)
	if e != nil {
		return b, e
	}
	entries := []Agenda{}
	for rows.Next() {
		a, err := scanAgenda(rows)
		if err != nil {
			rows.Close()
			return b, err
		}
		entries = append(entries, a)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return b, e
	}
	saved := map[string]occurrence{}
	rows, e = w.db.QueryContext(ctx, "SELECT series_id,done,deleted,revision FROM agenda_occurrences WHERE day=?", day)
	if e != nil {
		return b, e
	}
	for rows.Next() {
		var id string
		var o occurrence
		if e = rows.Scan(&id, &o.done, &o.deleted, &o.revision); e != nil {
			rows.Close()
			return b, e
		}
		saved[id] = o
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return b, e
	}
	for _, a := range entries {
		if a.Repeat != "none" {
			b.Series = append(b.Series, a)
			o, exists := saved[a.ID]
			if !exists && !repeatsOn(a, day) {
				continue
			}
			item := deriveItem(a, day, o)
			if item.Deleted {
				b.Skipped = append(b.Skipped, item)
			} else {
				b.Today = append(b.Today, item)
			}
			continue
		}
		item := PlannerItem{Agenda: a}
		if a.Important || a.Deadline != "" {
			if !a.Done {
				b.Important = append(b.Important, item)
			}
			continue
		}
		if a.Day == day {
			b.Today = append(b.Today, item)
		} else if !a.Done {
			if a.Day == "" {
				b.Unscheduled = append(b.Unscheduled, item)
			} else if a.Day < day {
				b.Overdue = append(b.Overdue, item)
			} else {
				b.Later = append(b.Later, item)
			}
		}
	}
	sort.SliceStable(b.Important, func(i, j int) bool { return plannerDate(b.Important[i].Agenda) < plannerDate(b.Important[j].Agenda) })
	sort.SliceStable(b.Today, func(i, j int) bool {
		a, z := b.Today[i], b.Today[j]
		if a.Done != z.Done {
			return !a.Done
		}
		if a.Start != z.Start {
			return a.Start != "" && (z.Start == "" || a.Start < z.Start)
		}
		return a.ID < z.ID
	})
	return b, nil
}
func (w *Workspace) plannerBoard(rw http.ResponseWriter, r *http.Request) {
	day := r.URL.Query().Get("day")
	if !matchesTime("2006-01-02", day) {
		fail(rw, 400, "请选择有效日期")
		return
	}
	b, e := w.readPlanner(r.Context(), day)
	if e != nil {
		databaseError(rw, e)
		return
	}
	respond(rw, 200, b)
}

type PlannerAction struct {
	RequestID      string `json:"requestId"`
	ID             string `json:"id"`
	SeriesID       string `json:"seriesId"`
	Day            string `json:"day"`
	Revision       int    `json:"revision"`
	SeriesRevision int    `json:"seriesRevision"`
	Action         string `json:"action"`
}

func (w *Workspace) plannerAction(rw http.ResponseWriter, r *http.Request) {
	var in PlannerAction
	if !readJSON(rw, r, 16<<10, &in) {
		return
	}
	if !validID(in.RequestID, 32) || !validID(in.ID, 32) || (in.Action != "complete" && in.Action != "reopen" && in.Action != "skip" && in.Action != "restore" && in.Action != "move") {
		fail(rw, 400, "待办操作无效")
		return
	}
	tx, e := w.db.BeginTx(r.Context(), nil)
	if e != nil {
		databaseError(rw, e)
		return
	}
	defer tx.Rollback()
	fp := fingerprint(in)
	var oldFP, oldBody string
	e = tx.QueryRowContext(r.Context(), "SELECT fingerprint,response FROM planner_receipts WHERE request_id=?", in.RequestID).Scan(&oldFP, &oldBody)
	if e == nil {
		if oldFP != fp {
			fail(rw, 409, "该请求已用于其他操作")
			return
		}
		rw.Header().Set("Content-Type", "application/json")
		_, _ = rw.Write([]byte(oldBody))
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		databaseError(rw, e)
		return
	}
	var result PlannerItem
	if in.SeriesID != "" {
		if in.Action == "move" { fail(rw, 400, "重复事项请修改规则"); return }
		if !validID(in.SeriesID, 32) || !matchesTime("2006-01-02", in.Day) || in.ID != occurrenceID(in.SeriesID, in.Day) {
			fail(rw, 400, "重复事项日期或身份无效")
			return
		}
		a, err := scanAgenda(tx.QueryRowContext(r.Context(), agendaSelect+" WHERE id=? AND deleted_at IS NULL", in.SeriesID))
		if err != nil {
			databaseError(rw, err)
			return
		}
		if a.Repeat == "none" || a.Revision != in.SeriesRevision {
			fail(rw, 409, "重复规则已更新，请刷新后核对")
			return
		}
		var o occurrence
		err = tx.QueryRowContext(r.Context(), "SELECT done,deleted,revision FROM agenda_occurrences WHERE series_id=? AND day=?", a.ID, in.Day).Scan(&o.done, &o.deleted, &o.revision)
		exists := err == nil
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			databaseError(rw, err)
			return
		}
		if (!exists && !repeatsOn(a, in.Day)) || o.revision != in.Revision {
			fail(rw, 409, "这一天的待办已改变，请刷新后核对")
			return
		}
		switch in.Action {
		case "complete":
			if o.deleted {
				fail(rw, 409, "请先恢复这一天的待办")
				return
			}
			o.done = true
		case "reopen":
			if o.deleted {
				fail(rw, 409, "请先恢复这一天的待办")
				return
			}
			o.done = false
		case "skip":
			o.deleted = true
		case "restore":
			o.deleted = false
		}
		o.revision++
		_, e = tx.ExecContext(r.Context(), `INSERT INTO agenda_occurrences(series_id,day,done,deleted,revision,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(series_id,day) DO UPDATE SET done=excluded.done,deleted=excluded.deleted,revision=excluded.revision,updated_at=excluded.updated_at`, a.ID, in.Day, o.done, o.deleted, o.revision, now())
		result = deriveItem(a, in.Day, o)
	} else {
		a, err := scanAgenda(tx.QueryRowContext(r.Context(), agendaSelect+" WHERE id=?", in.ID))
		if err != nil {
			databaseError(rw, err)
			return
		}
		if a.Repeat != "none" || a.Revision != in.Revision {
			fail(rw, 409, "事项已更新，请刷新后核对")
			return
		}
		if a.Deleted && in.Action != "restore" {
			fail(rw, 409, "请先恢复这项事项")
			return
		}
		var deleted any
		if a.Deleted {
			deleted = now()
		}
		switch in.Action {
		case "complete":
			a.Done = true
		case "reopen":
			a.Done = false
		case "skip":
			a.Deleted = true
			deleted = now()
		case "restore":
			a.Deleted = false
			deleted = nil
		}
		if in.Action == "move" {
			if a.Important || a.Deadline != "" || !matchesTime("2006-01-02",in.Day) { fail(rw,400,"重要日期不能直接改期"); return }; a.Day=in.Day
		}
		a.Revision++
		_, e = tx.ExecContext(r.Context(), "UPDATE agenda SET day=?,done=?,deleted_at=?,revision=?,updated_at=? WHERE id=?", a.Day,a.Done, deleted, a.Revision, now(), a.ID)
		result = PlannerItem{Agenda: a}
	}
	if e != nil {
		databaseError(rw, e)
		return
	}
	body, _ := json.Marshal(result)
	_, e = tx.ExecContext(r.Context(), "INSERT INTO planner_receipts(request_id,fingerprint,response) VALUES(?,?,?)", in.RequestID, fp, string(body))
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		databaseError(rw, e)
		return
	}
	respond(rw, 200, result)
}

func validPlannerAgenda(a Agenda) bool {
	if a.Important || a.Deadline != "" {
		if a.Repeat != "none" || !matchesTime("2006-01-02", plannerDate(a)) || (a.Milestone != "exam" && a.Milestone != "deadline" && a.Milestone != "other" && !(a.Milestone=="" && !a.Important && a.Deadline!="")) {
			return false
		}
		if a.Start != "" && !matchesTime("15:04", a.Start) {
			return false
		}
		if a.End != "" && (!matchesTime("15:04", a.End) || a.Start == "" || a.Start >= a.End) {
			return false
		}
	} else if a.Milestone != "" {
		return false
	}
	if a.Repeat != "none" {
		if (a.Repeat != "daily" && a.Repeat != "weekly") || !matchesTime("2006-01-02", a.Day) || a.Done || a.Deadline != "" {
			return false
		}
		if a.Repeat == "weekly" && (a.RepeatDays < 1 || a.RepeatDays > 127) {
			return false
		}
		if a.RepeatUntil != "" && (!matchesTime("2006-01-02", a.RepeatUntil) || a.RepeatUntil < a.Day) {
			return false
		}
	} else if a.RepeatDays != 0 || a.RepeatUntil != "" || a.Paused {
		return false
	}
	return true
}

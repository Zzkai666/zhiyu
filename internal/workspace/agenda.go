package workspace

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

type Project struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Area        string `json:"area"`
	Deadline    string `json:"deadline"`
	Revision    int    `json:"revision"`
}

func (w *Workspace) listProjects(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), "SELECT id,title,description,status,area,deadline,revision FROM projects ORDER BY updated_at DESC,id")
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer rows.Close()
	projects := []Project{}
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Title, &p.Description, &p.Status, &p.Area, &p.Deadline, &p.Revision); err != nil {
			databaseError(rw, err)
			return
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, projects)
}

func (w *Workspace) saveProject(rw http.ResponseWriter, r *http.Request) {
	var p Project
	if !readJSON(rw, r, 64<<10, &p) {
		return
	}
	p.Title = strings.TrimSpace(p.Title)
	if p.Title == "" || len(p.Title) > 1000 || len(p.Description) > 16000 ||
		!validWorkItem(p.Status, p.Area, p.Deadline) {
		fail(rw, 400, "项目信息无效")
		return
	}
	if r.Method == "POST" {
		p.ID, p.Revision = newID(), 1
		_, err := w.db.ExecContext(r.Context(), `INSERT INTO projects(id,title,description,status,area,deadline,updated_at) VALUES(?,?,?,?,?,?,?)`, p.ID, p.Title, p.Description, p.Status, p.Area, p.Deadline, now())
		if err != nil {
			databaseError(rw, err)
			return
		}
		respond(rw, 201, p)
		return
	}
	p.ID = r.PathValue("id")
	err := w.db.QueryRowContext(r.Context(), `UPDATE projects SET title=?,description=?,status=?,area=?,deadline=?,updated_at=?,revision=revision+1
        WHERE id=? AND revision=? RETURNING revision`, p.Title, p.Description, p.Status, p.Area, p.Deadline, now(), p.ID, p.Revision).Scan(&p.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		fail(rw, 409, "项目已更新，请刷新后重试")
		return
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, p)
}

type Agenda struct {
	Important   bool   `json:"important"`
	Milestone   string `json:"milestone"`
	Repeat      string `json:"repeat"`
	RepeatDays  int    `json:"repeatDays"`
	RepeatUntil string `json:"repeatUntil"`
	Paused      bool   `json:"paused"`
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Detail      string `json:"detail"`
	Day         string `json:"day"`
	Start       string `json:"start"`
	End         string `json:"end"`
	Deadline    string `json:"deadline"`
	ProjectID   string `json:"projectId"`
	PaperID     string `json:"paperId"`
	PaperPage   int    `json:"paperPage"`
	Done        bool   `json:"done"`
	Deleted     bool   `json:"deleted"`
	Revision    int    `json:"revision"`
}

const agendaSelect = `SELECT id,kind,title,detail,day,start,end,deadline,coalesce(project_id,''),
        coalesce(paper_id,''),paper_page,done,deleted_at IS NOT NULL,revision,important,milestone,repeat,repeat_days,repeat_until,paused FROM agenda`

func scanAgenda(row interface{ Scan(...any) error }) (Agenda, error) {
	var a Agenda
	err := row.Scan(&a.ID, &a.Kind, &a.Title, &a.Detail, &a.Day, &a.Start, &a.End, &a.Deadline, &a.ProjectID, &a.PaperID, &a.PaperPage, &a.Done, &a.Deleted, &a.Revision, &a.Important, &a.Milestone, &a.Repeat, &a.RepeatDays, &a.RepeatUntil, &a.Paused)
	return a, err
}

func (w *Workspace) listAgenda(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), agendaSelect+" ORDER BY day='',day,start,updated_at DESC,id")
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer rows.Close()
	rowsOut := []Agenda{}
	for rows.Next() {
		a, err := scanAgenda(rows)
		if err != nil {
			databaseError(rw, err)
			return
		}
		rowsOut = append(rowsOut, a)
	}
	if err := rows.Err(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, rowsOut)
}

func matchesTime(layout, value string) bool {
	result, err := time.Parse(layout, value)
	return err == nil && result.Format(layout) == value
}

func (w *Workspace) saveAgenda(rw http.ResponseWriter, r *http.Request) {
	var a Agenda
	if !readJSON(rw, r, 64<<10, &a) {
		return
	}
	a.Title = strings.TrimSpace(a.Title)
	if a.Repeat == "" {
		a.Repeat = "none"
	}
	if !validPlannerAgenda(a) {
		fail(rw, 400, "重要日期或重复规则无效")
		return
	}
	if a.Title == "" || len(a.Title) > 1000 || len(a.Detail) > 16000 || (a.Kind != "task" && a.Kind != "event") ||
		(a.Day != "" && !matchesTime("2006-01-02", a.Day)) || (a.Deadline != "" && !matchesTime("2006-01-02", a.Deadline)) ||
		(a.Kind == "event" && (a.Day == "" || !matchesTime("15:04", a.Start) || !matchesTime("15:04", a.End) || a.Start >= a.End)) ||
		(a.Kind == "task" && !a.Important && (a.Start != "" || a.End != "")) ||
		(a.PaperID == "" && a.PaperPage != 0) || (a.PaperID != "" && (!validID(a.PaperID, 64) || a.PaperPage < 1 || a.PaperPage > 100000)) {
		fail(rw, 400, "任务日期、时间或来源无效")
		return
	}
	tx, err := w.db.BeginTx(r.Context(), nil)
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer tx.Rollback()
	var project, paper, deleted any
	if a.ProjectID != "" {
		var id string
		if err = tx.QueryRowContext(r.Context(), "SELECT id FROM projects WHERE id=?", a.ProjectID).Scan(&id); err != nil {
			databaseError(rw, err)
			return
		}
		project = id
	}
	if a.PaperID != "" {
		var id string
		if err = tx.QueryRowContext(r.Context(), "SELECT id FROM papers WHERE id=?", a.PaperID).Scan(&id); err != nil {
			databaseError(rw, err)
			return
		}
		paper = id
	}
	if r.Method == "PATCH" {
		prior, err := scanAgenda(tx.QueryRowContext(r.Context(), agendaSelect+" WHERE id=?", r.PathValue("id")))
		if err != nil {
			databaseError(rw, err)
			return
		}
		if prior.Repeat != "none" && a.Repeat == "none" {
			fail(rw, 409, "请暂停重复规则，或新建普通事项；已有日期记录会保留")
			return
		}
	}
	timestamp := now()
	if r.Method == "POST" {
		if a.ID == "" {
			a.ID = newID()
		}
		if !validID(a.ID, 32) {
			fail(rw, 400, "新建安排标识无效")
			return
		}
		a.Revision, a.Deleted = 1, false
		var result sql.Result
		result, err = tx.ExecContext(r.Context(), `INSERT INTO agenda(id,kind,title,detail,day,start,end,deadline,project_id,paper_id,paper_page,done,updated_at,important,milestone,repeat,repeat_days,repeat_until,paused)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, a.ID, a.Kind, a.Title, a.Detail, a.Day, a.Start, a.End, a.Deadline, project, paper, a.PaperPage, a.Done, timestamp, a.Important, a.Milestone, a.Repeat, a.RepeatDays, a.RepeatUntil, a.Paused)
		if err == nil {
			var count int64
			count, err = result.RowsAffected()
			if err == nil && count == 0 {
				previous, readErr := scanAgenda(tx.QueryRowContext(r.Context(), agendaSelect+" WHERE id=?", a.ID))
				if readErr != nil {
					databaseError(rw, readErr)
					return
				}
				if previous != a {
					fail(rw, 409, "这项安排已经保存或更新，请先核对清单")
					return
				}
				respond(rw, 200, previous)
				return
			}
		}
	} else {
		a.ID = r.PathValue("id")
		if a.Deleted {
			deleted = timestamp
		}
		err = tx.QueryRowContext(r.Context(), `UPDATE agenda SET kind=?,title=?,detail=?,day=?,start=?,end=?,deadline=?,project_id=?,paper_id=?,
            paper_page=?,done=?,deleted_at=?,updated_at=?,important=?,milestone=?,repeat=?,repeat_days=?,repeat_until=?,paused=?,revision=revision+1 WHERE id=? AND revision=? RETURNING revision`,
			a.Kind, a.Title, a.Detail, a.Day, a.Start, a.End, a.Deadline, project, paper, a.PaperPage, a.Done, deleted, timestamp, a.Important, a.Milestone, a.Repeat, a.RepeatDays, a.RepeatUntil, a.Paused, a.ID, a.Revision).Scan(&a.Revision)
	}
	if errors.Is(err, sql.ErrNoRows) {
		fail(rw, 409, "任务已更新，请刷新后重试")
		return
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	status := 200
	if r.Method == "POST" {
		status = 201
	}
	respond(rw, status, a)
}

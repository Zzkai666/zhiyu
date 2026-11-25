package workspace

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"time"
)

type Milestone struct {
	Title string `json:"title"`
	Done  bool   `json:"done"`
}

type GoalMeasure struct {
	Kind       string      `json:"kind"`
	Current    float64     `json:"current"`
	Target     float64     `json:"target"`
	Unit       string      `json:"unit"`
	Percent    int         `json:"percent"`
	Milestones []Milestone `json:"milestones"`
}

type GoalDetails struct {
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Status      string      `json:"status"`
	Area        string      `json:"area"`
	Deadline    string      `json:"deadline"`
	Measure     GoalMeasure `json:"measure"`
}

type Goal struct {
	GoalDetails
	ID       string   `json:"id"`
	Revision int      `json:"revision"`
	Projects []string `json:"projects"`
}

type GoalChange struct {
	Goal    Goal   `json:"goal"`
	Reason  string `json:"reason"`
	SavedAt string `json:"savedAt"`
}

func validWorkItem(status, area, deadline string) bool {
	if status != "active" && status != "done" && status != "archived" {
		return false
	}
	switch area {
	case "", "research", "study", "fitness", "habit", "life":
	default:
		return false
	}
	if deadline == "" {
		return true
	}
	value, err := time.Parse(time.DateOnly, deadline)
	return err == nil && value.Year() > 0
}

func validMeasure(m *GoalMeasure) bool {
	switch m.Kind {
	case "numeric":
		m.Unit = strings.TrimSpace(m.Unit)
		m.Percent = 0
		m.Milestones = []Milestone{}
		return m.Current >= 0 && m.Current <= 1e12 && m.Target > 0 && m.Target <= 1e12 && len(m.Unit) <= 180
	case "milestones":
		m.Current, m.Target, m.Unit, m.Percent = 0, 0, "", 0
		if len(m.Milestones) > 50 {
			return false
		}
		if m.Milestones == nil {
			m.Milestones = []Milestone{}
		}
		for i := range m.Milestones {
			item := &m.Milestones[i]
			item.Title = strings.TrimSpace(item.Title)
			if item.Title == "" || len(item.Title) > 540 {
				return false
			}
		}
		return true
	case "manual":
		m.Current, m.Target, m.Unit, m.Milestones = 0, 0, "", []Milestone{}
		return m.Percent >= 0 && m.Percent <= 100
	}
	return false
}

type goalQueries interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func readGoals(ctx context.Context, q goalQueries, id string) ([]Goal, error) {
	rows, err := q.QueryContext(ctx, `SELECT g.id,g.data,g.revision,gp.project_id
		FROM goals g LEFT JOIN goal_projects gp ON gp.goal_id=g.id
		WHERE ?='' OR g.id=? ORDER BY g.updated_at DESC,g.id,gp.project_id`, id, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	goals := []Goal{}
	for rows.Next() {
		var goal Goal
		var data string
		var project sql.NullString
		if err = rows.Scan(&goal.ID, &data, &goal.Revision, &project); err != nil {
			return nil, err
		}
		if len(goals) == 0 || goals[len(goals)-1].ID != goal.ID {
			if err = json.Unmarshal([]byte(data), &goal.GoalDetails); err != nil {
				return nil, err
			}
			goal.Projects = []string{}
			goals = append(goals, goal)
		}
		if project.Valid {
			last := &goals[len(goals)-1]
			last.Projects = append(last.Projects, project.String)
		}
	}
	return goals, rows.Err()
}

func (w *Workspace) listGoals(rw http.ResponseWriter, r *http.Request) {
	goals, err := readGoals(r.Context(), w.db, "")
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, goals)
}

func (w *Workspace) saveGoal(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Goal
		Reason string `json:"reason"`
	}
	if !readJSON(rw, r, 128<<10, &input) {
		return
	}
	g := input.Goal
	g.Title = strings.TrimSpace(g.Title)
	reason := strings.TrimSpace(input.Reason)
	if r.Method == "PATCH" {
		g.ID = r.PathValue("id")
	}
	if !validID(g.ID, 32) || g.Title == "" || len(g.Title) > 1000 || len(g.Description) > 16000 ||
		len(reason) > 4000 || !validWorkItem(g.Status, g.Area, g.Deadline) || !validMeasure(&g.Measure) || len(g.Projects) > 200 {
		fail(rw, 400, "请核对目标名称、日期和进展")
		return
	}
	slices.Sort(g.Projects)
	if g.Projects == nil {
		g.Projects = []string{}
	}
	for i, p := range g.Projects {
		if !validID(p, 32) || i > 0 && p == g.Projects[i-1] {
			fail(rw, 400, "关联项目无效")
			return
		}
	}
	ctx := r.Context()
	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer tx.Rollback()
	existing, err := readGoals(ctx, tx, g.ID)
	if err != nil {
		databaseError(rw, err)
		return
	}
	status := 201
	updated := now()
	data, _ := json.Marshal(g.GoalDetails)
	if len(existing) == 0 {
		if r.Method != "POST" {
			fail(rw, 404, "找不到目标")
			return
		}
		g.Revision = 1
		_, err = tx.ExecContext(ctx, `INSERT INTO goals(id,data,revision,updated_at) VALUES(?,?,?,?)`, g.ID, string(data), g.Revision, updated)
	} else {
		old := existing[0]
		same := reflect.DeepEqual(old.GoalDetails, g.GoalDetails) && slices.Equal(old.Projects, g.Projects)
		if r.Method == "POST" {
			if same {
				respond(rw, 200, old)
			} else {
				fail(rw, 409, "此目标已经创建，请载入已保存版本")
			}
			return
		}
		if same {
			respond(rw, 200, old)
			return
		}
		if g.Revision != old.Revision {
			fail(rw, 409, "目标已更新，请先核对最新版本")
			return
		}
		if old.Measure.Kind != g.Measure.Kind {
			fail(rw, 400, "已创建目标的衡量方式固定")
			return
		}
		if !reflect.DeepEqual(old.Measure, g.Measure) && reason == "" {
			fail(rw, 400, "更新进展时请填写依据")
			return
		}
		g.Revision++
		status = 200
		_, err = tx.ExecContext(ctx, `UPDATE goals SET data=?,revision=?,updated_at=? WHERE id=?`, string(data), g.Revision, updated, g.ID)
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM goal_projects WHERE goal_id=?", g.ID); err != nil {
		databaseError(rw, err)
		return
	}
	for _, p := range g.Projects {
		var project string
		err = tx.QueryRowContext(ctx, `INSERT INTO goal_projects(goal_id,project_id)
			SELECT ?,id FROM projects WHERE id=? RETURNING project_id`, g.ID, p).Scan(&project)
		if errors.Is(err, sql.ErrNoRows) {
			fail(rw, 409, "关联项目已不可用")
			return
		}
		if err != nil {
			databaseError(rw, err)
			return
		}
	}
	snapshot, _ := json.Marshal(g)
	if _, err = tx.ExecContext(ctx, `INSERT INTO goal_history(goal_id,revision,snapshot,reason,saved_at) VALUES(?,?,?,?,?)`,
		g.ID, g.Revision, string(snapshot), reason, updated); err == nil {
		err = tx.Commit()
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, status, g)
}

func (w *Workspace) goalHistory(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), `SELECT snapshot,reason,saved_at FROM goal_history
		WHERE goal_id=? ORDER BY revision DESC LIMIT 100`, r.PathValue("id"))
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer rows.Close()
	changes := []GoalChange{}
	for rows.Next() {
		var row GoalChange
		var snapshot string
		if err = rows.Scan(&snapshot, &row.Reason, &row.SavedAt); err == nil {
			err = json.Unmarshal([]byte(snapshot), &row.Goal)
		}
		if err != nil {
			databaseError(rw, err)
			return
		}
		changes = append(changes, row)
	}
	if err = rows.Err(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, changes)
}

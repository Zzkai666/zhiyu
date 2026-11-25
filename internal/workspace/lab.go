package workspace

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

type Experiment struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Question  string `json:"question"`
	ProjectID string `json:"projectId"`
	Archived  bool   `json:"archived"`
	Revision  int    `json:"revision"`
}
type Metric struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
	Unit  string  `json:"unit"`
}
type Run struct {
	ID           string   `json:"id"`
	ExperimentID string   `json:"experimentId"`
	Title        string   `json:"title"`
	Day          string   `json:"day"`
	Status       string   `json:"status"`
	Condition    string   `json:"condition"`
	Metrics      []Metric `json:"metrics"`
	Revision     int      `json:"revision"`
}

func (w *Workspace) listExperiments(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), "SELECT id,title,question,coalesce(project_id,''),archived,revision FROM experiments ORDER BY archived,title,id")
	list(rw, rows, err, func(row *sql.Rows, v *Experiment) error {
		return row.Scan(&v.ID, &v.Title, &v.Question, &v.ProjectID, &v.Archived, &v.Revision)
	})
}
func (w *Workspace) saveExperiment(rw http.ResponseWriter, r *http.Request) {
	var v Experiment
	if !readJSON(rw, r, 64<<10, &v) {
		return
	}
	v.Title = strings.TrimSpace(v.Title)
	if !validTitle(v.Title) || len(v.Question) > 16000 {
		fail(rw, 400, "实验名称或研究问题无效")
		return
	}
	p := optionalID(v.ProjectID)
	var err error
	if r.Method == "POST" {
		v.ID, v.Revision, v.Archived = newID(), 1, false
		err = w.db.QueryRowContext(r.Context(), `INSERT INTO experiments(id,title,question,project_id)
            SELECT ?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM projects WHERE id=?) RETURNING revision`,
			v.ID, v.Title, v.Question, p, p, p).Scan(&v.Revision)
	} else {
		v.ID = r.PathValue("id")
		err = w.db.QueryRowContext(r.Context(), `UPDATE experiments SET title=?,question=?,project_id=?,archived=?,revision=revision+1
            WHERE id=? AND revision=? AND (? IS NULL OR EXISTS(SELECT 1 FROM projects WHERE id=?)) RETURNING revision`,
			v.Title, v.Question, p, v.Archived, v.ID, v.Revision, p, p).Scan(&v.Revision)
	}
	writeResult(rw, r, err, v)
}
func (w *Workspace) listRuns(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), `SELECT id,experiment_id,title,day,status,condition,metrics,revision
        FROM runs WHERE experiment_id=? ORDER BY day DESC,created_at DESC`, r.PathValue("experiment"))
	list(rw, rows, err, func(row *sql.Rows, v *Run) error {
		var data string
		if err := row.Scan(&v.ID, &v.ExperimentID, &v.Title, &v.Day, &v.Status, &v.Condition, &data, &v.Revision); err != nil {
			return err
		}
		return json.Unmarshal([]byte(data), &v.Metrics)
	})
}
func (w *Workspace) saveRun(rw http.ResponseWriter, r *http.Request) {
	var v Run
	if !readJSON(rw, r, 96<<10, &v) {
		return
	}
	v.Title = strings.TrimSpace(v.Title)
	if !validTitle(v.Title) || !actualDay(v.Day) || len(v.Condition) > 16000 || len(v.Metrics) > 40 ||
		(v.Status != "finished" && v.Status != "failed" && v.Status != "incomplete") {
		fail(rw, 400, "运行名称、状态、日期或指标无效")
		return
	}
	seen := map[[2]string]bool{}
	for i := range v.Metrics {
		m := &v.Metrics[i]
		m.Name, m.Unit = strings.TrimSpace(m.Name), strings.TrimSpace(m.Unit)
		key := [2]string{m.Name, m.Unit}
		if m.Name == "" || len(m.Name) > 160 || len(m.Unit) > 80 || seen[key] {
			fail(rw, 400, "指标需有名称，且相同名称和单位只能填写一次")
			return
		}
		seen[key] = true
	}
	if v.Metrics == nil {
		v.Metrics = []Metric{}
	}
	metrics, _ := json.Marshal(v.Metrics)
	v.ExperimentID = r.PathValue("experiment")
	var err error
	if r.Method == "POST" {
		v.ID, v.Revision = newID(), 1
		err = w.db.QueryRowContext(r.Context(), `INSERT INTO runs(id,experiment_id,title,day,status,condition,metrics,created_at)
            SELECT ?,id,?,?,?,?,?,? FROM experiments WHERE id=? AND archived=0 RETURNING revision`,
			v.ID, v.Title, v.Day, v.Status, v.Condition, string(metrics), now(), v.ExperimentID).Scan(&v.Revision)
	} else {
		v.ID = r.PathValue("id")
		err = w.db.QueryRowContext(r.Context(), `UPDATE runs SET title=?,day=?,status=?,condition=?,metrics=?,revision=revision+1
            WHERE id=? AND experiment_id=? AND revision=? AND EXISTS(SELECT 1 FROM experiments WHERE id=experiment_id AND archived=0)
            RETURNING revision`, v.Title, v.Day, v.Status, v.Condition, string(metrics), v.ID, v.ExperimentID, v.Revision).Scan(&v.Revision)
	}
	writeResult(rw, r, err, v)
}

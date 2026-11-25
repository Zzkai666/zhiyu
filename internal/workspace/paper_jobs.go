package workspace

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type PaperJob struct {
	PaperID   string          `json:"paperId"`
	Title     string          `json:"title"`
	Stage     string          `json:"stage"`
	State     string          `json:"state"`
	Done      int             `json:"done"`
	Total     int             `json:"total"`
	Message   string          `json:"message"`
	Payload   json.RawMessage `json:"payload"`
	Token     string          `json:"token,omitempty"`
	Revision  int             `json:"revision"`
	UpdatedAt string          `json:"updatedAt"`
}
type TranslationRequest struct {
	Connection         string `json:"connection,omitempty"`
	ConnectionRevision int    `json:"connectionRevision,omitempty"`
	Scope              string `json:"scope"`
	Page               int    `json:"page"`
	Group              string `json:"group,omitempty"`
	Model              string `json:"model"`
	Effort             string `json:"effort"`
	Revision           int    `json:"revision"`
}

const jobSelect = "SELECT j.paper_id,p.title,j.stage,j.state,j.done,j.total,j.message,j.payload,j.token,j.revision,j.updated_at FROM paper_jobs j JOIN papers p ON p.id=j.paper_id WHERE p.deleted_at IS NULL"

func scanJob(row interface{ Scan(...any) error }) (PaperJob, error) {
	var j PaperJob
	var raw string
	err := row.Scan(&j.PaperID, &j.Title, &j.Stage, &j.State, &j.Done, &j.Total, &j.Message, &raw, &j.Token, &j.Revision, &j.UpdatedAt)
	j.Payload = json.RawMessage(raw)
	return j, err
}
func (w *Workspace) ensurePaperJobs(ctx context.Context) error {
	_, err := w.db.ExecContext(ctx, "INSERT OR IGNORE INTO paper_jobs(paper_id,stage,state,updated_at) SELECT id,'parse','queued',? FROM papers WHERE deleted_at IS NULL", now())
	return err
}
func (w *Workspace) recoverPaperJobs() error {
	_, err := w.db.Exec("UPDATE paper_jobs SET state=CASE stage WHEN 'parse' THEN 'queued' ELSE 'paused' END,token='',message=CASE stage WHEN 'parse' THEN '将继续解析未完成页' ELSE '上次退出时翻译中断，已保存批次保留；点击继续' END,revision=revision+1,updated_at=? WHERE state IN ('running','queued')", now())
	if err != nil {
		return err
	}
	return w.ensurePaperJobs(context.Background())
}
func (w *Workspace) listPaperJobs(rw http.ResponseWriter, r *http.Request) {
	if err := w.ensurePaperJobs(r.Context()); err != nil {
		databaseError(rw, err)
		return
	}
	rows, err := w.db.QueryContext(r.Context(), jobSelect+" ORDER BY j.updated_at,j.paper_id,j.stage")
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer rows.Close()
	jobs := []PaperJob{}
	for rows.Next() {
		j, e := scanJob(rows)
		if e != nil {
			databaseError(rw, e)
			return
		}
		jobs = append(jobs, j)
	}
	if rows.Err() != nil {
		databaseError(rw, rows.Err())
		return
	}
	respond(rw, 200, jobs)
}
func (w *Workspace) paperJob(rw http.ResponseWriter, r *http.Request) {
	paper, stage := r.PathValue("id"), r.PathValue("stage")
	if stage != "parse" && stage != "translate" {
		fail(rw, 400, "处理阶段无效")
		return
	}
	var in struct {
		Action   string             `json:"action"`
		Token    string             `json:"token"`
		Revision int                `json:"revision"`
		Done     int                `json:"done"`
		Total    int                `json:"total"`
		Message  string             `json:"message"`
		Payload  TranslationRequest `json:"payload"`
	}
	if !readJSON(rw, r, 8192, &in) {
		return
	}
	if len(in.Message) > 2000 || in.Done < 0 || in.Total < 0 || in.Total > 100000 {
		fail(rw, 400, "处理进度无效")
		return
	}
	w.jobLock.Lock()
	defer w.jobLock.Unlock()
	var active string
	if err := w.db.QueryRowContext(r.Context(), "SELECT id FROM papers WHERE id=? AND deleted_at IS NULL", paper).Scan(&active); err != nil {
		databaseError(rw, err)
		return
	}
	current, err := scanJob(w.db.QueryRowContext(r.Context(), jobSelect+" AND j.paper_id=? AND j.stage=?", paper, stage))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		databaseError(rw, err)
		return
	}
	exists := err == nil
	state, done, total, note, payload, token := current.State, current.Done, current.Total, current.Message, string(current.Payload), current.Token
	if payload == "" {
		payload = "{}"
	}
	switch in.Action {
	case "start":
		if exists && (state == "queued" || state == "running") {
			respond(rw, 200, current)
			return
		}
		if stage == "translate" {
			s := translateInput{Groups: []string{""}, Model: in.Payload.Model, Effort: in.Payload.Effort, Connection: in.Payload.Connection, ConnectionRevision: in.Payload.ConnectionRevision}
			if !validTranslationInput(s, 1) || (in.Payload.Scope != "paper" && in.Payload.Scope != "page" && in.Payload.Scope != "one") {
				fail(rw, 400, "请选择模型、有效的强度和翻译范围")
				return
			}
			plan, e := w.translationPlan(r.Context(), paper)
			if e != nil {
				databaseError(rw, e)
				return
			}
			if plan.Revision != in.Payload.Revision {
				fail(rw, 409, "解析分组已变化，请刷新后翻译")
				return
			}
			if in.Payload.Scope == "paper" {
				var pages, known int
				e = w.db.QueryRowContext(r.Context(), "SELECT count(*),coalesce((SELECT page_count FROM paper_extras WHERE paper_id=?),0) FROM reading_pages WHERE paper_id=?", paper, paper).Scan(&pages, &known)
				if e != nil {
					databaseError(rw, e)
					return
				}
				if known == 0 || pages != known {
					fail(rw, 409, "请先等待全文解析完成")
					return
				}
				if len(plan.Review) > 0 {
					fail(rw, 409, "请先完成解析核对")
					return
				}
			}
			b, _ := json.Marshal(in.Payload)
			payload = string(b)
			done, total = 0, 0
		}
		state, token, note = "queued", "", "等待后台处理"
	case "claim":
		if !exists || state != "queued" {
			fail(rw, 409, "任务状态已变化")
			return
		}
		state = "running"
		token = newID()
		note = "正在后台处理"
	case "pause":
		if !exists {
			fail(rw, 404, "任务不存在")
			return
		}
		if in.Revision != current.Revision {
			fail(rw, 409, "任务状态已变化，请重试")
			return
		}
		if state == "done" {
			respond(rw, 200, current)
			return
		}
		state, token, note = "paused", "", "已暂停，已保存的结果保留"
	case "resume":
		if !exists || (state != "paused" && state != "failed") {
			fail(rw, 409, "任务不能继续")
			return
		}
		if in.Revision != current.Revision {
			fail(rw, 409, "任务状态已变化")
			return
		}
		if stage == "translate" {
			var p TranslationRequest
			if json.Unmarshal(current.Payload, &p) != nil {
				fail(rw, 409, "任务配置损坏")
				return
			}
			plan, e := w.translationPlan(r.Context(), paper)
			if e != nil {
				databaseError(rw, e)
				return
			}
			if p.Scope == "paper" && len(plan.Review) > 0 {
				fail(rw, 409, "解析有待核对项，请先核对")
				return
			}
			p.Revision = plan.Revision
			b, _ := json.Marshal(p)
			payload = string(b)
		}
		state, token, note = "queued", "", "等待继续未完成部分"
	case "progress", "complete", "fail":
		if !exists || state != "running" || token == "" || token != in.Token {
			fail(rw, 409, "任务已停止或由其他执行器接管")
			return
		}
		done, total, note = in.Done, in.Total, in.Message
		if total > 0 && done > total {
			fail(rw, 400, "进度超出总数")
			return
		}
		if in.Action == "complete" {
			if stage == "translate" {
				var input TranslationRequest
				if json.Unmarshal(current.Payload, &input) != nil {
					fail(rw, 409, "任务配置损坏")
					return
				}
				plan, e := w.translationPlan(r.Context(), paper)
				if e != nil {
					databaseError(rw, e)
					return
				}
				for _, g := range plan.Groups {
					include := input.Scope == "paper" || input.Scope == "one" && g.ID == input.Group
					if input.Scope == "page" {
						for _, part := range g.Regions {
							include = include || part.Page == input.Page
						}
					}
					if include && g.Translate && g.Translation == "" {
						fail(rw, 409, "仍有未保存译文，任务尚未完成")
						return
					}
				}
			}
			if stage == "parse" {
				var pages, known int
				if err := w.db.QueryRowContext(r.Context(), "SELECT count(*),coalesce((SELECT page_count FROM paper_extras WHERE paper_id=?),0) FROM reading_pages WHERE paper_id=?", paper, paper).Scan(&pages, &known); err != nil {
					databaseError(rw, err)
					return
				}
				if known == 0 || known != pages {
					fail(rw, 409, "全文尚未解析完成")
					return
				}
				done, total = pages, known
				plan, e := w.translationPlan(r.Context(), paper)
				if e != nil {
					databaseError(rw, e)
					return
				}
				encoded, _ := json.Marshal(map[string]int{"reviewTotal": len(plan.Review)})
				payload = string(encoded)
			}
			state, token = "done", ""
		} else if in.Action == "fail" {
			state, token = "failed", ""
			if strings.TrimSpace(note) == "" {
				note = "后台处理未完成，可以重试"
			}
		}
	default:
		fail(rw, 400, "任务操作无效")
		return
	}
	_, err = w.db.ExecContext(r.Context(), "INSERT INTO paper_jobs(paper_id,stage,state,done,total,message,payload,token,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(paper_id,stage) DO UPDATE SET state=excluded.state,done=excluded.done,total=excluded.total,message=excluded.message,payload=excluded.payload,token=excluded.token,revision=paper_jobs.revision+1,updated_at=excluded.updated_at", paper, stage, state, done, total, note, payload, token, now())
	if err != nil {
		databaseError(rw, err)
		return
	}
	j, err := scanJob(w.db.QueryRowContext(r.Context(), jobSelect+" AND j.paper_id=? AND j.stage=?", paper, stage))
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, j)
}

func (w *Workspace) recoverPaperJobClient(rw http.ResponseWriter, r *http.Request) {
	w.jobLock.Lock()
	defer w.jobLock.Unlock()
	_, err := w.db.ExecContext(r.Context(), "UPDATE paper_jobs SET state=CASE stage WHEN 'parse' THEN 'queued' ELSE 'paused' END,token='',message=CASE stage WHEN 'parse' THEN '将继续解析未完成页' ELSE '连接已重置，已保存批次保留；点击继续翻译' END,revision=revision+1,updated_at=? WHERE state='running'", now())
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, true)
}

func (w *Workspace) readStageSummary(rw http.ResponseWriter, r *http.Request) {
	plan, err := w.translationPlan(r.Context(), r.PathValue("id"))
	if err != nil {
		databaseError(rw, err)
		return
	}
	total, saved := 0, 0
	for _, g := range plan.Groups {
		if g.Translate {
			total++
			if g.Translation != "" {
				saved++
			}
		}
	}
	respond(rw, 200, map[string]int{"revision": plan.Revision, "pending": len(plan.Review), "confirmed": len(plan.ConfirmedReview), "total": total, "saved": saved})
}

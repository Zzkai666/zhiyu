package workspace

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type ResearchSource struct {
	TaskID       string `json:"taskId"`
	PaperID      string `json:"paperId"`
	Page         int    `json:"page"`
	MarkID       string `json:"markId"`
	MarkRevision int    `json:"markRevision"`
	Quote        string `json:"quote"`
	Rects        []Rect `json:"rects"`
}
type ResearchTaskInput struct {
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	Detail    string         `json:"detail"`
	Day       string         `json:"day"`
	ProjectID string         `json:"projectId"`
	Source    ResearchSource `json:"source"`
}

func fingerprint(v any) string {
	b, _ := json.Marshal(v)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func (w *Workspace) createResearchTask(rw http.ResponseWriter, r *http.Request) {
	var in ResearchTaskInput
	if !readJSON(rw, r, 64<<10, &in) {
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	s := in.Source
	if !validID(in.ID, 32) || in.Title == "" || len(in.Title) > 1000 || len(in.Detail) > 16000 || !validID(s.PaperID, 64) || s.Page < 1 || s.Page > 100000 ||
		(in.Day != "" && !matchesTime("2006-01-02", in.Day)) || len(s.Quote) > 16000 || len(s.Rects) > 200 {
		fail(rw, 400, "研究任务或来源无效")
		return
	}
	for _, rect := range s.Rects {
		if !rect.valid() {
			fail(rw, 400, "来源区域无效")
			return
		}
	}
	fp := fingerprint(in)
	tx, err := w.db.BeginTx(r.Context(), nil)
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer tx.Rollback()
	var prior string
	err = tx.QueryRowContext(r.Context(), "SELECT fingerprint FROM research_sources WHERE task_id=?", in.ID).Scan(&prior)
	if err == nil {
		if prior != fp {
			fail(rw, 409, "该请求已保存其他内容，请刷新核对")
			return
		}
		a, e := scanAgenda(tx.QueryRowContext(r.Context(), agendaSelect+" WHERE id=?", in.ID))
		if e != nil {
			databaseError(rw, e)
			return
		}
		respond(rw, 200, a)
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		databaseError(rw, err)
		return
	}
	var paperID string
	if err = tx.QueryRowContext(r.Context(), "SELECT id FROM papers WHERE id=? AND deleted_at IS NULL", s.PaperID).Scan(&paperID); err != nil {
		databaseError(rw, err)
		return
	}
	var project any
	if in.ProjectID != "" {
		var id string
		if err = tx.QueryRowContext(r.Context(), "SELECT id FROM projects WHERE id=? AND status!='archived'", in.ProjectID).Scan(&id); err != nil {
			databaseError(rw, err)
			return
		}
		project = id
	}
	if s.MarkID != "" {
		var page, revision int
		var quote, rects, comment, content string
		err = tx.QueryRowContext(r.Context(), "SELECT page,revision,quote,rects,comment,content FROM marks WHERE id=? AND paper_id=?", s.MarkID, s.PaperID).Scan(&page, &revision, &quote, &rects, &comment, &content)
		if err != nil {
			databaseError(rw, err)
			return
		}
		if page != s.Page || revision != s.MarkRevision {
			fail(rw, 409, "批注已更新，请保存并重新创建研究任务")
			return
		}
		s.Quote = quote
		if s.Quote == "" {
			s.Quote = content
		}
		if s.Quote == "" {
			s.Quote = comment
		}
		if err = json.Unmarshal([]byte(rects), &s.Rects); err != nil {
			databaseError(rw, err)
			return
		}
	}
	rects, _ := json.Marshal(s.Rects)
	stamp := now()
	_, err = tx.ExecContext(r.Context(), `INSERT INTO agenda(id,kind,title,detail,day,start,end,deadline,project_id,paper_id,paper_page,done,updated_at) VALUES(?,'task',?,?,?,'','','',?,?,?,0,?)`, in.ID, in.Title, in.Detail, in.Day, project, s.PaperID, s.Page, stamp)
	if err != nil {
		fail(rw, 409, "这项任务已经存在，请刷新核对")
		return
	}
	_, err = tx.ExecContext(r.Context(), `INSERT INTO research_sources(task_id,paper_id,page,mark_id,mark_revision,quote,rects,fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?)`, in.ID, s.PaperID, s.Page, s.MarkID, s.MarkRevision, s.Quote, string(rects), fp, stamp)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 201, Agenda{ID: in.ID, Kind: "task", Title: in.Title, Detail: in.Detail, Day: in.Day, ProjectID: in.ProjectID, PaperID: s.PaperID, PaperPage: s.Page, Revision: 1})
}

func (w *Workspace) researchSource(rw http.ResponseWriter, r *http.Request) {
	var s ResearchSource
	var rects string
	err := w.db.QueryRowContext(r.Context(), "SELECT task_id,paper_id,page,mark_id,mark_revision,quote,rects FROM research_sources WHERE task_id=?", r.PathValue("id")).Scan(&s.TaskID, &s.PaperID, &s.Page, &s.MarkID, &s.MarkRevision, &s.Quote, &rects)
	if errors.Is(err, sql.ErrNoRows) {
		a, e := scanAgenda(w.db.QueryRowContext(r.Context(), agendaSelect+" WHERE id=? AND deleted_at IS NULL", r.PathValue("id")))
		if e != nil {
			databaseError(rw, e)
			return
		}
		if a.PaperID == "" {
			fail(rw, 404, "该任务没有论文来源")
			return
		}
		s = ResearchSource{TaskID: a.ID, PaperID: a.PaperID, Page: a.PaperPage, Rects: []Rect{}}
	} else if err != nil {
		databaseError(rw, err)
		return
	} else if err = json.Unmarshal([]byte(rects), &s.Rects); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, s)
}

type FocusSession struct {
	ID             string `json:"id"`
	TaskID         string `json:"taskId"`
	TaskRevision   int    `json:"taskRevision"`
	Title          string `json:"title"`
	PlannedSeconds int    `json:"plannedSeconds"`
	ElapsedSeconds int    `json:"elapsedSeconds"`
	State          string `json:"state"`
	RunningSince   string `json:"runningSince"`
	StartedAt      string `json:"startedAt"`
	UpdatedAt      string `json:"updatedAt"`
	Result         string `json:"result"`
	Note           string `json:"note"`
	Revision       int    `json:"revision"`
}

const focusSelect = "SELECT id,task_id,task_revision,title,planned_seconds,elapsed_seconds,state,running_since,started_at,updated_at,result,note,revision FROM focus_sessions"

func scanFocus(row interface{ Scan(...any) error }) (FocusSession, error) {
	var f FocusSession
	err := row.Scan(&f.ID, &f.TaskID, &f.TaskRevision, &f.Title, &f.PlannedSeconds, &f.ElapsedSeconds, &f.State, &f.RunningSince, &f.StartedAt, &f.UpdatedAt, &f.Result, &f.Note, &f.Revision)
	return f, err
}
func focusElapsed(f FocusSession, at time.Time) int {
	if f.State != "running" {
		return f.ElapsedSeconds
	}
	start, e := time.Parse(time.RFC3339Nano, f.RunningSince)
	if e != nil {
		return f.ElapsedSeconds
	}
	delta := int(at.Sub(start).Seconds())
	if delta < 0 {
		delta = 0
	}
	result := f.ElapsedSeconds + delta
	if result > f.PlannedSeconds {
		result = f.PlannedSeconds
	}
	return result
}

// Restart never credits time while this application was not running.
func (w *Workspace) interruptFocus() error {
	_, err := w.db.Exec("UPDATE focus_sessions SET state='interrupted',running_since='',updated_at=?,revision=revision+1 WHERE state='running'", now())
	return err
}
func (w *Workspace) companionSnapshot(rw http.ResponseWriter, r *http.Request) {
	w.focusLock.Lock()
	defer w.focusLock.Unlock()
	// The timer advances only between recent live checkpoints; sleep/offline gaps are interrupted.
	stamp := time.Now().UTC()
	err := w.checkpointFocus(r.Context(), stamp)
	if err != nil {
		databaseError(rw, err)
		return
	}
	recent, err := scanPaper(w.db.QueryRowContext(r.Context(), paperSelect+" WHERE p.deleted_at IS NULL ORDER BY r.updated_at IS NULL,r.updated_at DESC,p.added_at DESC,p.id LIMIT 1"))
	var recentPtr *Paper
	if err == nil {
		recentPtr = &recent
	} else if !errors.Is(err, sql.ErrNoRows) {
		databaseError(rw, err)
		return
	}
	rows, err := w.db.QueryContext(r.Context(), agendaSelect+" WHERE kind='task' AND repeat='none' AND important=0 AND done=0 AND deleted_at IS NULL ORDER BY paper_id IS NULL,day='',day,updated_at DESC LIMIT 20")
	if err != nil {
		databaseError(rw, err)
		return
	}
	tasks := []Agenda{}
	for rows.Next() {
		a, e := scanAgenda(rows)
		if e != nil {
			rows.Close()
			databaseError(rw, e)
			return
		}
		tasks = append(tasks, a)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		databaseError(rw, err)
		return
	}
	var active *FocusSession
	f, err := scanFocus(w.db.QueryRowContext(r.Context(), focusSelect+" WHERE state!='finished' LIMIT 1"))
	if err == nil {
		f.ElapsedSeconds = focusElapsed(f, stamp)
		active = &f
	} else if !errors.Is(err, sql.ErrNoRows) {
		databaseError(rw, err)
		return
	}
	historyRows, err := w.db.QueryContext(r.Context(), focusSelect+" WHERE state='finished' ORDER BY updated_at DESC LIMIT 8")
	if err != nil {
		databaseError(rw, err)
		return
	}
	history := []FocusSession{}
	for historyRows.Next() {
		f, e := scanFocus(historyRows)
		if e != nil {
			historyRows.Close()
			databaseError(rw, e)
			return
		}
		history = append(history, f)
	}
	err = historyRows.Err()
	historyRows.Close()
	if err != nil {
		databaseError(rw, err)
		return
	}
	day := r.URL.Query().Get("day")
	if day == "" {
		day = time.Now().In(time.Local).Format("2006-01-02")
	}
	if !matchesTime("2006-01-02", day) {
		fail(rw, 400, "日期无效")
		return
	}
	board, err := w.readPlanner(r.Context(), day)
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, map[string]any{"recent": recentPtr, "tasks": tasks, "focus": active, "history": history, "planner": board, "serverTime": stamp.Format(time.RFC3339Nano)})
}

type FocusCommand struct {
	RequestID    string `json:"requestId"`
	Action       string `json:"action"`
	ID           string `json:"id"`
	TaskID       string `json:"taskId"`
	Revision     int    `json:"revision"`
	TaskRevision int    `json:"taskRevision"`
	Minutes      int    `json:"minutes"`
	Result       string `json:"result"`
	Note         string `json:"note"`
}

func (w *Workspace) focusCommand(rw http.ResponseWriter, r *http.Request) {
	w.focusLock.Lock()
	defer w.focusLock.Unlock()
	if err := w.checkpointFocus(r.Context(), time.Now().UTC()); err != nil {
		databaseError(rw, err)
		return
	}
	var in FocusCommand
	if !readJSON(rw, r, 32<<10, &in) {
		return
	}
	if !validID(in.RequestID, 32) || len(in.Note) > 8000 {
		fail(rw, 400, "专注请求无效")
		return
	}
	tx, err := w.db.BeginTx(r.Context(), nil)
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer tx.Rollback()
	fp := fingerprint(in)
	var oldFP, oldBody string
	err = tx.QueryRowContext(r.Context(), "SELECT fingerprint,response FROM focus_receipts WHERE request_id=?", in.RequestID).Scan(&oldFP, &oldBody)
	if err == nil {
		if oldFP != fp {
			fail(rw, 409, "专注请求标识已使用")
			return
		}
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(200)
		_, _ = rw.Write([]byte(oldBody))
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		databaseError(rw, err)
		return
	}
	stamp := time.Now().UTC()
	textStamp := stamp.Format(time.RFC3339Nano)
	var f FocusSession
	if in.Action == "start" {
		if !validID(in.ID, 32) || !validID(in.TaskID, 32) || in.Minutes < 1 || in.Minutes > 180 {
			fail(rw, 400, "请选择任务和 1–180 分钟时长")
			return
		}
		a, e := scanAgenda(tx.QueryRowContext(r.Context(), agendaSelect+" WHERE id=? AND kind='task' AND repeat='none' AND important=0 AND done=0 AND deleted_at IS NULL", in.TaskID))
		if e != nil {
			databaseError(rw, e)
			return
		}
		if in.TaskRevision != a.Revision {
			fail(rw, 409, "任务已更新，请刷新后开始")
			return
		}
		var active int
		if e = tx.QueryRowContext(r.Context(), "SELECT count(*) FROM focus_sessions WHERE state!='finished'").Scan(&active); e != nil {
			databaseError(rw, e)
			return
		}
		if active > 0 {
			fail(rw, 409, "请先处理当前专注，再开始下一项")
			return
		}
		f = FocusSession{ID: in.ID, TaskID: a.ID, TaskRevision: a.Revision, Title: a.Title, PlannedSeconds: in.Minutes * 60, State: "running", RunningSince: textStamp, StartedAt: textStamp, UpdatedAt: textStamp, Revision: 1}
		_, err = tx.ExecContext(r.Context(), `INSERT INTO focus_sessions(id,task_id,task_revision,title,planned_seconds,state,running_since,started_at,updated_at) VALUES(?,?,?,?,?,'running',?,?,?)`, f.ID, f.TaskID, f.TaskRevision, f.Title, f.PlannedSeconds, textStamp, textStamp, textStamp)
	} else {
		f, err = scanFocus(tx.QueryRowContext(r.Context(), focusSelect+" WHERE id=?", in.ID))
		if err != nil {
			databaseError(rw, err)
			return
		}
		if f.Revision != in.Revision || f.State == "finished" {
			fail(rw, 409, "专注状态已更新，请刷新核对")
			return
		}
		f.ElapsedSeconds = focusElapsed(f, stamp)
		f.RunningSince = ""
		switch in.Action {
		case "pause":
			if f.State != "running" {
				fail(rw, 409, "该专注当前未在计时")
				return
			}
			f.State = "paused"
		case "resume":
			if f.State != "paused" && f.State != "interrupted" {
				fail(rw, 409, "该专注不能继续计时")
				return
			}
			if f.ElapsedSeconds >= f.PlannedSeconds {
				f.State = "review"
			} else {
				f.State = "running"
				f.RunningSince = textStamp
			}
		case "stop":
			f.State = "review"
		case "finish":
			if in.Result != "done" && in.Result != "continue" {
				fail(rw, 400, "请确认任务已完成或稍后继续")
				return
			}
			if in.Result == "done" {
				result, e := tx.ExecContext(r.Context(), "UPDATE agenda SET done=1,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND deleted_at IS NULL AND done=0", textStamp, f.TaskID, f.TaskRevision)
				if e != nil {
					databaseError(rw, e)
					return
				}
				count, _ := result.RowsAffected()
				if count != 1 {
					fail(rw, 409, "任务在专注期间已修改或完成。请核对后选择“稍后继续”保存本次记录")
					return
				}
			}
			f.State = "finished"
			f.Result = in.Result
			f.Note = strings.TrimSpace(in.Note)
		default:
			fail(rw, 400, "不支持的专注操作")
			return
		}
		f.UpdatedAt = textStamp
		f.Revision++
		_, err = tx.ExecContext(r.Context(), `UPDATE focus_sessions SET state=?,elapsed_seconds=?,running_since=?,updated_at=?,result=?,note=?,revision=? WHERE id=?`, f.State, f.ElapsedSeconds, f.RunningSince, f.UpdatedAt, f.Result, f.Note, f.Revision, f.ID)
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	body, _ := json.Marshal(f)
	_, err = tx.ExecContext(r.Context(), "INSERT INTO focus_receipts(request_id,fingerprint,response) VALUES(?,?,?)", in.RequestID, fp, string(body))
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, f)
}

func (w *Workspace) checkpointFocus(ctx context.Context, at time.Time) error {
	f, err := scanFocus(w.db.QueryRowContext(ctx, focusSelect+" WHERE state='running' LIMIT 1"))
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	start, err := time.Parse(time.RFC3339Nano, f.RunningSince)
	if err != nil {
		return err
	}
	delta := int(at.Sub(start).Seconds())
	if delta < 0 || delta > 10 {
		_, err = w.db.ExecContext(ctx, "UPDATE focus_sessions SET state='interrupted',running_since='',updated_at=?,revision=revision+1 WHERE id=? AND state='running'", at.Format(time.RFC3339Nano), f.ID)
		return err
	}
	if delta == 0 {
		return nil
	}
	elapsed := f.ElapsedSeconds + delta
	if elapsed >= f.PlannedSeconds {
		_, err = w.db.ExecContext(ctx, "UPDATE focus_sessions SET state='review',elapsed_seconds=planned_seconds,running_since='',updated_at=?,revision=revision+1 WHERE id=? AND state='running'", at.Format(time.RFC3339Nano), f.ID)
	} else {
		_, err = w.db.ExecContext(ctx, "UPDATE focus_sessions SET elapsed_seconds=?,running_since=?,updated_at=? WHERE id=? AND state='running'", elapsed, start.Add(time.Duration(delta)*time.Second).Format(time.RFC3339Nano), at.Format(time.RFC3339Nano), f.ID)
	}
	return err
}

func (w *Workspace) runFocusClock() {
	defer close(w.focusStopped)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	checkpoint := func() {
		w.focusLock.Lock()
		defer w.focusLock.Unlock()
		_ = w.checkpointFocus(context.Background(), time.Now().UTC())
	}
	for {
		select {
		case <-w.focusStop:
			checkpoint()
			return
		case <-ticker.C:
			checkpoint()
		}
	}
}

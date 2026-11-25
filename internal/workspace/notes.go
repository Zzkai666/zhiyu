package workspace

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

type Note struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	PaperID   string `json:"paperId"`
	Page      int    `json:"page"`
	Quote     string `json:"quote"`
	UpdatedAt string `json:"updatedAt"`
	Revision  int    `json:"revision"`
	Deleted   bool   `json:"deleted"`
}

func (w *Workspace) listNotes(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), `SELECT id,title,body,coalesce(paper_id,''),page,quote,updated_at,revision,deleted_at IS NOT NULL FROM notes ORDER BY updated_at DESC,id`)
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer rows.Close()
	notes := []Note{}
	for rows.Next() {
		var n Note
		if err := rows.Scan(&n.ID, &n.Title, &n.Body, &n.PaperID, &n.Page, &n.Quote, &n.UpdatedAt, &n.Revision, &n.Deleted); err != nil {
			databaseError(rw, err)
			return
		}
		notes = append(notes, n)
	}
	if err := rows.Err(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, notes)
}

func readNote(rw http.ResponseWriter, r *http.Request, n *Note) bool {
	if !readJSON(rw, r, 1<<20, n) {
		return false
	}
	n.Title = strings.TrimSpace(n.Title)
	if n.Title == "" || len(n.Title) > 1000 || len(n.Quote) > 32000 {
		fail(rw, 400, "请填写有效笔记标题")
		return false
	}
	return true
}

func (w *Workspace) createNote(rw http.ResponseWriter, r *http.Request) {
	var n Note
	if !readNote(rw, r, &n) {
		return
	}
	var source any
	if n.PaperID != "" {
		if !validID(n.PaperID, 64) || n.Page < 1 || n.Page > 100000 {
			fail(rw, 400, "笔记来源无效")
			return
		}
		source = n.PaperID
	} else if n.Page != 0 || n.Quote != "" {
		fail(rw, 400, "笔记来源无效")
		return
	}
	n.ID, n.UpdatedAt, n.Revision, n.Deleted = newID(), now(), 1, false
	res, err := w.db.ExecContext(r.Context(), `INSERT INTO notes(id,title,body,paper_id,page,quote,updated_at)
        SELECT ?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM papers WHERE id=? AND deleted_at IS NULL)`,
		n.ID, n.Title, n.Body, source, n.Page, n.Quote, n.UpdatedAt, source, source)
	if err != nil {
		databaseError(rw, err)
		return
	}
	if count, _ := res.RowsAffected(); count != 1 {
		fail(rw, 404, "笔记来源不可用")
		return
	}
	respond(rw, 201, n)
}

func (w *Workspace) editNote(rw http.ResponseWriter, r *http.Request) {
	var n Note
	if !readNote(rw, r, &n) {
		return
	}
	n.ID = r.PathValue("id")
	tx, err := w.db.BeginTx(r.Context(), nil)
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer tx.Rollback()
	err = tx.QueryRowContext(r.Context(), `INSERT INTO note_history(note_id,revision,title,body,updated_at)
        SELECT id,revision,title,body,updated_at FROM notes WHERE id=? AND revision=?
        RETURNING revision`, n.ID, n.Revision).Scan(&n.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		fail(rw, 409, "笔记已更新，请刷新后重试")
		return
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	n.UpdatedAt = now()
	var deleted any
	if n.Deleted {
		deleted = n.UpdatedAt
	}
	err = tx.QueryRowContext(r.Context(), `UPDATE notes SET title=?,body=?,updated_at=?,deleted_at=?,revision=revision+1 WHERE id=?
        RETURNING revision,coalesce(paper_id,''),page,quote`, n.Title, n.Body, n.UpdatedAt, deleted, n.ID).Scan(&n.Revision, &n.PaperID, &n.Page, &n.Quote)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, n)
}

func (w *Workspace) noteHistory(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), `SELECT revision,title,body,updated_at FROM note_history WHERE note_id=? ORDER BY revision DESC`, r.PathValue("id"))
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer rows.Close()
	notes := []Note{}
	for rows.Next() {
		var n Note
		if err := rows.Scan(&n.Revision, &n.Title, &n.Body, &n.UpdatedAt); err != nil {
			databaseError(rw, err)
			return
		}
		notes = append(notes, n)
	}
	if err := rows.Err(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, notes)
}

type Word struct {
	ID       string `json:"id"`
	Term     string `json:"term"`
	Meaning  string `json:"meaning"`
	PaperID  string `json:"paperId"`
	Page     int    `json:"page"`
	Quote    string `json:"quote"`
	DueAt    string `json:"dueAt"`
	Interval int    `json:"interval"`
	Revision int    `json:"revision"`
}

const wordSelect = "SELECT id,term,meaning,coalesce(paper_id,''),page,quote,due_at,interval_days,revision FROM words"

func scanWord(row interface{ Scan(...any) error }) (Word, error) {
	var v Word
	err := row.Scan(&v.ID, &v.Term, &v.Meaning, &v.PaperID, &v.Page, &v.Quote, &v.DueAt, &v.Interval, &v.Revision)
	return v, err
}
func (w *Workspace) listWords(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), wordSelect+" ORDER BY due_at,id")
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer rows.Close()
	words := []Word{}
	for rows.Next() {
		v, err := scanWord(rows)
		if err != nil {
			databaseError(rw, err)
			return
		}
		words = append(words, v)
	}
	if err := rows.Err(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, words)
}
func (w *Workspace) createWord(rw http.ResponseWriter, r *http.Request) {
	var v Word
	if !readJSON(rw, r, 64<<10, &v) {
		return
	}
	v.Term = strings.TrimSpace(v.Term)
	if v.Term == "" || len(v.Term) > 500 || len(v.Meaning) > 16000 || len(v.Quote) > 32000 {
		fail(rw, 400, "词条内容无效")
		return
	}
	var source any
	if v.PaperID != "" {
		if !validID(v.PaperID, 64) || v.Page < 1 || v.Page > 100000 {
			fail(rw, 400, "词条来源无效")
			return
		}
		source = v.PaperID
	} else if v.Page != 0 || v.Quote != "" {
		fail(rw, 400, "词条来源无效")
		return
	}
	v.ID, v.DueAt, v.Interval, v.Revision = newID(), now(), 0, 1
	res, err := w.db.ExecContext(r.Context(), `INSERT INTO words(id,term,meaning,paper_id,page,quote,due_at)
        SELECT ?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM papers WHERE id=? AND deleted_at IS NULL)`,
		v.ID, v.Term, v.Meaning, source, v.Page, v.Quote, v.DueAt, source, source)
	if err != nil {
		databaseError(rw, err)
		return
	}
	if count, _ := res.RowsAffected(); count != 1 {
		fail(rw, 404, "词条来源不可用")
		return
	}
	respond(rw, 201, v)
}
func (w *Workspace) captureWord(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Term    string `json:"term"`
		Quote   string `json:"quote"`
		PaperID string `json:"paperId"`
		Page    int    `json:"page"`
	}
	if !readJSON(rw, r, 8192, &input) {
		return
	}
	input.Term = strings.TrimSpace(input.Term)
	input.Quote = strings.TrimSpace(input.Quote)
	if input.Term == "" || len(input.Term) > 500 || input.Quote == "" || len(input.Quote) > 6000 ||
		!validID(input.PaperID, 64) || input.Page < 1 || input.Page > 100000 {
		fail(rw, 400, "收词内容或来源无效")
		return
	}
	ctx := r.Context()
	// The existence check and insert are one SQLite statement, so retrying
	// this source does not create another card or overwrite its meaning.
	const matching = "paper_id=? AND page=? AND term=? COLLATE NOCASE AND quote=?"
	const sourceExists = "EXISTS(SELECT 1 FROM papers WHERE id=? AND deleted_at IS NULL)"
	existing := []any{input.PaperID, input.Page, input.Term, input.Quote, input.PaperID}
	v, err := scanWord(w.db.QueryRowContext(ctx,
		"INSERT INTO words(id,term,meaning,paper_id,page,quote,due_at) SELECT ?,?,'',?,?,?,? WHERE "+
			sourceExists+" AND NOT EXISTS (SELECT 1 FROM words WHERE "+matching+
			") RETURNING id,term,meaning,paper_id,page,quote,due_at,interval_days,revision",
		newID(), input.Term, input.PaperID, input.Page, input.Quote, now(), input.PaperID,
		input.PaperID, input.Page, input.Term, input.Quote))
	if errors.Is(err, sql.ErrNoRows) {
		v, err = scanWord(w.db.QueryRowContext(ctx, wordSelect+" WHERE "+matching+" AND "+sourceExists+" ORDER BY id LIMIT 1", existing...))
		if errors.Is(err, sql.ErrNoRows) {
			fail(rw, 404, "词条来源不可用")
			return
		}
		if err == nil {
			respond(rw, 200, map[string]any{"word": v, "existing": true})
			return
		}
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 201, map[string]any{"word": v, "existing": false})
}

func (w *Workspace) updateWordMeaning(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Meaning  string `json:"meaning"`
		Revision int    `json:"revision"`
	}
	if !readJSON(rw, r, 32<<10, &input) {
		return
	}
	input.Meaning = strings.TrimSpace(input.Meaning)
	if len(input.Meaning) > 16000 {
		fail(rw, 400, "释义过长")
		return
	}
	v, err := scanWord(w.db.QueryRowContext(r.Context(),
		"UPDATE words SET meaning=?,revision=revision+1 WHERE id=? AND revision=? "+
			"RETURNING id,term,meaning,coalesce(paper_id,''),page,quote,due_at,interval_days,revision",
		input.Meaning, r.PathValue("id"), input.Revision))
	if errors.Is(err, sql.ErrNoRows) {
		fail(rw, 409, "词条已更新，请重新打开后再保存")
		return
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, v)
}

func (w *Workspace) reviewWord(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Known    bool `json:"known"`
		Revision int  `json:"revision"`
	}
	if !readJSON(rw, r, 1024, &input) {
		return
	}
	id := r.PathValue("id")
	v, err := scanWord(w.db.QueryRowContext(r.Context(), wordSelect+" WHERE id=?", id))
	if err != nil {
		databaseError(rw, err)
		return
	}
	if strings.TrimSpace(v.Meaning) == "" {
		fail(rw, 400, "请先补充释义")
		return
	}
	delay := 0
	if input.Known {
		delay = min(365, max(1, v.Interval*2))
	}
	due := time.Now().UTC().AddDate(0, 0, delay).Format("2006-01-02T15:04:05.000Z")
	err = w.db.QueryRowContext(r.Context(), `UPDATE words SET due_at=?,interval_days=?,revision=revision+1 WHERE id=? AND revision=? RETURNING revision`,
		due, delay, id, input.Revision).Scan(&v.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		fail(rw, 409, "复习记录已更新，请刷新后重试")
		return
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	v.DueAt, v.Interval = due, delay
	respond(rw, 200, v)
}

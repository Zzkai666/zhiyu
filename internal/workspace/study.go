package workspace

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

type Course struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Archived    bool   `json:"archived"`
	Revision    int    `json:"revision"`
}

type Chapter struct {
	ID       string `json:"id"`
	CourseID string `json:"courseId"`
	Title    string `json:"title"`
	State    string `json:"state"`
	PaperID  string `json:"paperId"`
	Page     int    `json:"page"`
	Revision int    `json:"revision"`
}

type StudyRecord struct {
	ID        string `json:"id"`
	ChapterID string `json:"chapterId"`
	Day       string `json:"day"`
	Minutes   int    `json:"minutes"`
	Detail    string `json:"detail"`
}

func list[T any](rw http.ResponseWriter, rows *sql.Rows, err error, scan func(*sql.Rows, *T) error) {
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer rows.Close()
	items := []T{}
	for rows.Next() {
		var item T
		if err := scan(rows, &item); err != nil {
			databaseError(rw, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, items)
}
func optionalID(id string) any {
	if id == "" {
		return nil
	}
	return id
}
func validTitle(title string) bool { return title != "" && len(title) <= 1000 }
func actualDay(day string) bool {
	return matchesTime("2006-01-02", day) && day <= time.Now().Format("2006-01-02")
}
func writeResult(rw http.ResponseWriter, r *http.Request, err error, value any) {
	if errors.Is(err, sql.ErrNoRows) {
		fail(rw, 409, "记录已更新，或关联资料已不可用")
		return
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	code := 200
	if r.Method == "POST" {
		code = 201
	}
	respond(rw, code, value)
}

func (w *Workspace) listCourses(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), "SELECT id,title,description,archived,revision FROM courses ORDER BY archived,title,id")
	list(rw, rows, err, func(row *sql.Rows, c *Course) error {
		return row.Scan(&c.ID, &c.Title, &c.Description, &c.Archived, &c.Revision)
	})
}
func (w *Workspace) saveCourse(rw http.ResponseWriter, r *http.Request) {
	var c Course
	if !readJSON(rw, r, 64<<10, &c) {
		return
	}
	c.Title = strings.TrimSpace(c.Title)
	if !validTitle(c.Title) || len(c.Description) > 16000 {
		fail(rw, 400, "请填写有效的课程名称和说明")
		return
	}
	var err error
	if r.Method == "POST" {
		c.ID, c.Revision, c.Archived = newID(), 1, false
		_, err = w.db.ExecContext(r.Context(), "INSERT INTO courses(id,title,description) VALUES(?,?,?)", c.ID, c.Title, c.Description)
	} else {
		c.ID = r.PathValue("id")
		err = w.db.QueryRowContext(r.Context(), `UPDATE courses SET title=?,description=?,archived=?,revision=revision+1 WHERE id=? AND revision=?
            RETURNING revision`, c.Title, c.Description, c.Archived, c.ID, c.Revision).Scan(&c.Revision)
	}
	writeResult(rw, r, err, c)
}
func (w *Workspace) listChapters(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), `SELECT id,course_id,title,state,coalesce(paper_id,''),paper_page,revision
        FROM chapters WHERE course_id=? ORDER BY created_at,id`, r.PathValue("course"))
	list(rw, rows, err, func(row *sql.Rows, c *Chapter) error {
		return row.Scan(&c.ID, &c.CourseID, &c.Title, &c.State, &c.PaperID, &c.Page, &c.Revision)
	})
}
func (w *Workspace) saveChapter(rw http.ResponseWriter, r *http.Request) {
	var c Chapter
	if !readJSON(rw, r, 32<<10, &c) {
		return
	}
	c.CourseID = r.PathValue("course")
	c.Title = strings.TrimSpace(c.Title)
	if !validTitle(c.Title) || (c.State != "pending" && c.State != "reading" && c.State != "done") ||
		(c.PaperID == "" && c.Page != 0) || (c.PaperID != "" && (!validID(c.PaperID, 64) || c.Page < 1 || c.Page > 100000)) {
		fail(rw, 400, "章节名称、状态或原文页码无效")
		return
	}
	paper := optionalID(c.PaperID)
	var err error
	if r.Method == "POST" {
		c.ID, c.Revision = newID(), 1
		err = w.db.QueryRowContext(r.Context(), `INSERT INTO chapters(id,course_id,title,state,paper_id,paper_page,created_at)
            SELECT ?,id,?,?,?,?,? FROM courses WHERE id=? AND archived=0
            AND (? IS NULL OR EXISTS(SELECT 1 FROM papers WHERE id=? AND deleted_at IS NULL)) RETURNING revision`,
			c.ID, c.Title, c.State, paper, c.Page, now(), c.CourseID, paper, paper).Scan(&c.Revision)
	} else {
		c.ID = r.PathValue("id")
		err = w.db.QueryRowContext(r.Context(), `UPDATE chapters SET title=?,state=?,paper_id=?,paper_page=?,revision=revision+1
            WHERE id=? AND course_id=? AND revision=? AND EXISTS(SELECT 1 FROM courses WHERE id=course_id AND archived=0)
            AND (? IS NULL OR paper_id=? OR EXISTS(SELECT 1 FROM papers WHERE id=? AND deleted_at IS NULL)) RETURNING revision`,
			c.Title, c.State, paper, c.Page, c.ID, c.CourseID, c.Revision, paper, paper, paper).Scan(&c.Revision)
	}
	writeResult(rw, r, err, c)
}
func (w *Workspace) listStudy(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), "SELECT id,chapter_id,day,minutes,detail FROM study_records WHERE chapter_id=? ORDER BY day DESC,created_at DESC LIMIT 100", r.PathValue("chapter"))
	list(rw, rows, err, func(row *sql.Rows, v *StudyRecord) error {
		return row.Scan(&v.ID, &v.ChapterID, &v.Day, &v.Minutes, &v.Detail)
	})
}
func (w *Workspace) saveStudy(rw http.ResponseWriter, r *http.Request) {
	var v StudyRecord
	if !readJSON(rw, r, 32<<10, &v) {
		return
	}
	if !actualDay(v.Day) || v.Minutes < 0 || v.Minutes > 1440 || len(v.Detail) > 16000 || (v.Minutes == 0 && strings.TrimSpace(v.Detail) == "") {
		fail(rw, 400, "请填写实际日期，以及学习时间或说明")
		return
	}
	v.ID, v.ChapterID = newID(), r.PathValue("chapter")
	err := w.db.QueryRowContext(r.Context(), `INSERT INTO study_records(id,chapter_id,day,minutes,detail,created_at)
        SELECT ?,h.id,?,?,?,? FROM chapters h JOIN courses c ON h.course_id=c.id WHERE h.id=? AND c.archived=0 RETURNING id`,
		v.ID, v.Day, v.Minutes, v.Detail, now(), v.ChapterID).Scan(&v.ID)
	writeResult(rw, r, err, v)
}

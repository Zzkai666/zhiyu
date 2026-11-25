package workspace

import (
	"database/sql"
	"errors"
	"net/http"
)

func (w *Workspace) savePreviewInfo(rw http.ResponseWriter, r *http.Request) {
	var in struct {
		Pages int `json:"pages"`
	}
	if !readJSON(rw, r, 1024, &in) {
		return
	}
	if in.Pages < 1 || in.Pages > 100000 {
		fail(rw, 400, "PDF 页数无效")
		return
	}
	id := r.PathValue("id")
	result, err := w.db.ExecContext(r.Context(), `INSERT INTO paper_extras(paper_id,page_count)
 SELECT id,? FROM papers WHERE id=? AND deleted_at IS NULL
 ON CONFLICT(paper_id) DO UPDATE SET page_count=excluded.page_count
 WHERE paper_extras.page_count=0 OR paper_extras.page_count=excluded.page_count`, in.Pages, id)
	if err != nil {
		databaseError(rw, err)
		return
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		var exists int
		_ = w.db.QueryRowContext(r.Context(), "SELECT count(*) FROM papers WHERE id=? AND deleted_at IS NULL", id).Scan(&exists)
		if exists == 0 {
			fail(rw, 404, "文献不可用")
		} else {
			fail(rw, 409, "PDF 页数与已保存信息不同，请重新打开文献核对")
		}
		return
	}
	respond(rw, 200, map[string]int{"pages": in.Pages})
}

func (w *Workspace) savePaperRemark(rw http.ResponseWriter, r *http.Request) {
	var in struct {
		Remark   string `json:"remark"`
		Revision int    `json:"revision"`
	}
	if !readJSON(rw, r, 24<<10, &in) {
		return
	}
	if len(in.Remark) > 16000 || in.Revision < 0 {
		fail(rw, 400, "备注内容无效")
		return
	}
	id := r.PathValue("id")
	tx, err := w.db.BeginTx(r.Context(), nil)
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer tx.Rollback()
	var exists int
	if err = tx.QueryRowContext(r.Context(), "SELECT count(*) FROM papers WHERE id=? AND deleted_at IS NULL", id).Scan(&exists); err != nil {
		databaseError(rw, err)
		return
	}
	if exists == 0 {
		fail(rw, 404, "文献不可用")
		return
	}
	var remark string
	var revision int
	err = tx.QueryRowContext(r.Context(), "SELECT remark,remark_revision FROM paper_extras WHERE paper_id=?", id).Scan(&remark, &revision)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		databaseError(rw, err)
		return
	}
	if revision != in.Revision {
		if revision == in.Revision+1 && remark == in.Remark {
			respond(rw, 200, map[string]any{"remark": remark, "revision": revision})
			return
		}
		fail(rw, 409, "备注已在其他位置更新；当前输入已保留，请重新核对")
		return
	}
	_, err = tx.ExecContext(r.Context(), `INSERT INTO paper_extras(paper_id,remark,remark_revision) VALUES(?,?,1)
 ON CONFLICT(paper_id) DO UPDATE SET remark=excluded.remark,remark_revision=paper_extras.remark_revision+1`, id, in.Remark)
	if err != nil {
		databaseError(rw, err)
		return
	}
	if err = tx.Commit(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, map[string]any{"remark": in.Remark, "revision": revision + 1})
}

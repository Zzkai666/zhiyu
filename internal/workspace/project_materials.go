package workspace

import (
	"net/http"
)

type ProjectMaterial struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

func (w *Workspace) projectMaterials(rw http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	rows, err := w.db.QueryContext(r.Context(), `SELECT 'paper',target_id FROM project_papers WHERE project_id=?
		UNION ALL SELECT 'note',target_id FROM project_notes WHERE project_id=? ORDER BY 1,2`, id, id)
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer rows.Close()
	materials := []ProjectMaterial{}
	for rows.Next() {
		var m ProjectMaterial
		if err = rows.Scan(&m.Kind, &m.ID); err != nil {
			databaseError(rw, err)
			return
		}
		materials = append(materials, m)
	}
	if err = rows.Err(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, materials)
}

func (w *Workspace) changeProjectMaterial(rw http.ResponseWriter, r *http.Request) {
	project, kind, id := r.PathValue("id"), r.PathValue("kind"), r.PathValue("target")
	var table, source string
	switch kind {
	case "paper":
		table, source = "project_papers", "papers"
	case "note":
		table, source = "project_notes", "notes"
	}
	if table == "" || !validID(project, 32) || kind == "paper" && !validID(id, 64) || kind == "note" && !validID(id, 32) {
		fail(rw, 400, "项目或材料标识无效")
		return
	}
	ctx := r.Context()
	if r.Method == "DELETE" {
		_, err := w.db.ExecContext(ctx, "DELETE FROM "+table+" WHERE project_id=? AND target_id=?", project, id)
		if err != nil {
			databaseError(rw, err)
			return
		}
		respond(rw, 200, true)
		return
	}
	res, err := w.db.ExecContext(ctx, "INSERT INTO "+table+`(project_id,target_id)
		SELECT p.id,m.id FROM projects p CROSS JOIN `+source+` m
		WHERE p.id=? AND p.status!='archived' AND m.id=? AND m.deleted_at IS NULL
		ON CONFLICT(project_id,target_id) DO UPDATE SET target_id=excluded.target_id`, project, id)
	if err != nil {
		databaseError(rw, err)
		return
	}
	if count, _ := res.RowsAffected(); count != 1 {
		fail(rw, 409, "项目已归档或材料已不可用")
		return
	}
	respond(rw, 200, true)
}

package workspace

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"sync"
	"time"
)

type mergeTranslationInput struct {
	Connection         string   `json:"connection,omitempty"`
	ConnectionRevision int      `json:"connectionRevision,omitempty"`
	Groups             []string `json:"groups"`
	Revision           int      `json:"revision"`
	Model              string   `json:"model"`
	Effort             string   `json:"effort"`
}

func mergeTranslationCandidate(plan ReadingPlan, edits ReadingEdits, ids []string) (ReadingPlan, ReadingEdits, ReadingGroup, error) {
	empty := ReadingGroup{}
	if len(ids) < 2 || len(ids) > 20 {
		return plan, edits, empty, translationFail(400, "请选择 2–20 个完整正文段落")
	}
	wanted := map[string]bool{}
	for _, id := range ids {
		if !validID(id, 64) || wanted[id] {
			return plan, edits, empty, translationFail(400, "所选段落无效或重复")
		}
		wanted[id] = true
	}
	selected := []string{}
	for _, g := range plan.Groups {
		if wanted[g.ID] {
			if !g.Translate {
				return plan, edits, empty, translationFail(409, "所选段落设为无需翻译，请先核对类别和翻译设置")
			}
			for _, r := range g.Regions {
				if !paragraph(r.Kind) {
					return plan, edits, empty, translationFail(400, "只能连接明确选中的正文或摘要，图表保留原位")
				}
			}
			selected = append(selected, g.Regions[0].ID)
		}
	}
	if len(selected) != len(ids) {
		return plan, edits, empty, translationFail(409, "所选段落已变化，请重新选择")
	}
	joined, ok := joinSelected(plan, edits, selected)
	if !ok {
		return plan, edits, empty, translationFail(400, "请选择同页或连续页面上的正文段落")
	}
	regions := []Region{}
	for _, g := range plan.Groups {
		regions = append(regions, g.Regions...)
	}
	slices.SortFunc(regions, func(a, b Region) int {
		if regionBefore(a, b) {
			return -1
		}
		if regionBefore(b, a) {
			return 1
		}
		return 0
	})
	candidate := makeReadingPlan(plan.Pages, regions, joined, plan.Revision+1)
	member := selected[0]
	for _, g := range candidate.Groups {
		for _, r := range g.Regions {
			if r.ID == member {
				return candidate, joined, g, nil
			}
		}
	}
	return plan, edits, empty, translationFail(409, "无法核对完整段落")
}

func (w *Workspace) commitMergedTranslation(ctx context.Context, paper string, input mergeTranslationInput, expected ReadingGroup, text string) error {
	w.readerLock.Lock()
	defer w.readerLock.Unlock()
	live, edits, err := w.readReadingPlan(ctx, paper)
	if err != nil {
		return err
	}
	if live.Revision != input.Revision {
		return translationFail(409, "核对或分组已变化，当前结果未采用；原译文保持")
	}
	_, joined, group, err := mergeTranslationCandidate(live, edits, input.Groups)
	if err != nil {
		return err
	}
	if group.ID != expected.ID {
		return translationFail(409, "原文已变化，当前结果未采用")
	}
	raw, err := json.Marshal(joined)
	if err != nil {
		return err
	}
	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT INTO reading_translations(paper_id,fingerprint,text,model,effort,saved_at) VALUES(?,?,?,?,?,?) ON CONFLICT(paper_id,fingerprint) DO UPDATE SET text=excluded.text,model=excluded.model,effort=excluded.effort,saved_at=excluded.saved_at`, paper, group.ID, text, input.Model, input.Effort, now()); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO reading_edits(paper_id,revision,edits) VALUES(?,?,?) ON CONFLICT(paper_id) DO UPDATE SET revision=excluded.revision,edits=excluded.edits`, paper, live.Revision+1, string(raw)); err != nil {
		return err
	}
	return tx.Commit()
}

func (w *Workspace) mergeAndTranslate(rw http.ResponseWriter, r *http.Request) {
	var input mergeTranslationInput
	if !readJSON(rw, r, 8192, &input) {
		return
	}
	if !validTranslationInput(translateInput{Groups: input.Groups, Model: input.Model, Effort: input.Effort, Connection: input.Connection, ConnectionRevision: input.ConnectionRevision}, 20) {
		fail(rw, 400, "请选择段落、模型和思考强度")
		return
	}
	if !w.translationLock.TryLock() {
		fail(rw, 409, "另一个翻译任务正在处理")
		return
	}
	defer w.translationLock.Unlock()
	paper := r.PathValue("id")
	w.readerLock.Lock()
	plan, edits, err := w.readReadingPlan(r.Context(), paper)
	w.readerLock.Unlock()
	if err != nil {
		databaseError(rw, err)
		return
	}
	if plan.Revision != input.Revision {
		fail(rw, 409, "段落已修改，请重新读取后选择")
		return
	}
	candidate, _, group, err := mergeTranslationCandidate(plan, edits, input.Groups)
	if err != nil {
		fail(rw, translationStatus(err), err.Error())
		return
	}
	// Carry existing unaffected translations as terminology context, without altering their saved identities.
	saved := map[string]ReadingGroup{}
	for _, g := range plan.Groups {
		saved[g.ID] = g
	}
	for i := range candidate.Groups {
		if old, ok := saved[candidate.Groups[i].ID]; ok {
			candidate.Groups[i].Translation = old.Translation
		}
	}
	batch, err := prepareTranslation(candidate, []string{group.ID})
	if err != nil {
		fail(rw, translationStatus(err), err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 9*time.Minute)
	defer cancel()
	_ = http.NewResponseController(rw).SetWriteDeadline(time.Time{})
	rw.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	var mu sync.Mutex
	emit := func(value any) bool {
		mu.Lock()
		defer mu.Unlock()
		if json.NewEncoder(rw).Encode(value) != nil {
			return false
		}
		return http.NewResponseController(rw).Flush() == nil
	}
	if !emit(map[string]any{"kind": "start", "total": 1, "batches": 1}) {
		return
	}
	done := make(chan struct{})
	defer func() { cancel(); <-done }()
	go func() {
		defer close(done)
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if !emit(map[string]any{"kind": "heartbeat"}) {
					cancel()
					return
				}
			}
		}
	}()
	connecting := time.AfterFunc(45*time.Second, cancel)
	run, closeRun, err := w.openTranslation(ctx, translateInput{Model: input.Model, Effort: input.Effort, Connection: input.Connection, ConnectionRevision: input.ConnectionRevision})
	connecting.Stop()
	if err != nil {
		emit(map[string]any{"kind": "error", "message": err.Error()})
		return
	}
	defer closeRun()
	batchCtx, stopBatch := context.WithTimeout(ctx, 8*time.Minute)
	defer stopBatch()
	raw, err := run(batchCtx, batch)
	if err == nil && batchCtx.Err() != nil {
		err = batchCtx.Err()
	}
	if err == nil {
		var accepted map[string]string
		accepted, err = validateTranslation(raw, batch)
		if err == nil {
			err = w.commitMergedTranslation(ctx, paper, input, group, accepted[group.ID])
		}
	}
	if err != nil {
		if ctx.Err() == nil {
			emit(map[string]any{"kind": "error", "message": err.Error()})
		}
		return
	}
	emit(map[string]any{"kind": "done", "done": 1, "total": 1, "group": group.ID})
}

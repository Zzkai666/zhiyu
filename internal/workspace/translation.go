package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

func (w *Workspace) listCodexModels(rw http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 35*time.Second)
	defer cancel()
	c, err := w.openCodex(ctx)
	if err != nil {
		fail(rw, 503, err.Error())
		return
	}
	defer c.close()
	models, err := c.models()
	if err != nil {
		fail(rw, 502, err.Error())
		return
	}
	respond(rw, 200, models)
}

type translateInput struct {
	Connection         string   `json:"connection,omitempty"`
	ConnectionRevision int      `json:"connectionRevision,omitempty"`
	Groups             []string `json:"groups"`
	Model              string   `json:"model"`
	Effort             string   `json:"effort"`
	Full               bool     `json:"full,omitempty"`
	Replace            bool     `json:"replace,omitempty"`
	Revision           *int     `json:"revision,omitempty"`
	freshSession       bool
}
type TranslationItem struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// Layout extraction preserves line-break hyphens. Keep the hyphen and close only
// letter-to-letter gaps so subtraction, numeric ranges and list markers stay intact.
var trailingWordHyphen = regexp.MustCompile(`(\p{L}{2,}[-‐])[ \t]+(\p{L}{2,})`)
var leadingWordHyphen = regexp.MustCompile(`(\p{L}{2,})[ \t]+([-‐]\p{L}{2,})`)

func translationSource(text string) string {
	// Gaps with spaces on both sides can be a real dash in prose.
	for {
		next := trailingWordHyphen.ReplaceAllString(text, "${1}${2}")
		next = leadingWordHyphen.ReplaceAllString(next, "${1}${2}")
		if next == text {
			return text
		}
		text = next
	}
}

type translationFailure struct {
	status  int
	message string
}

func (e *translationFailure) Error() string            { return e.message }
func translationFail(status int, message string) error { return &translationFailure{status, message} }
func translationStatus(err error) int {
	var failure *translationFailure
	if errors.As(err, &failure) {
		return failure.status
	}
	return 500
}
func validTranslationInput(input translateInput, limit int) bool {
	return len(input.Groups) > 0 && len(input.Groups) <= limit && input.Model != "" && len(input.Model) <= 200 &&
		validTranslationConnection(input.Connection) &&
		(input.Connection != "buddy" || input.Effort == "" || input.Model != "@default" && slices.Contains(buddyEffortLevels, input.Effort)) &&
		(input.Effort == "" || effortName.MatchString(input.Effort) || input.Connection == "harness" && input.Effort == "off")
}

type preparedTranslation struct {
	targets      []TranslationItem
	payload      []byte
	freshSession bool
}

func (b preparedTranslation) prompt(continued bool) string {
	if !continued {
		return string(b.payload)
	}
	body, _ := json.Marshal(map[string]any{"targets": b.targets})
	return string(body)
}

func prepareTranslation(plan ReadingPlan, ids []string) (preparedTranslation, error) {
	return prepareTranslationWithReplacement(plan, ids, false)
}

func prepareTranslationWithReplacement(plan ReadingPlan, ids []string, replaceExisting bool) (preparedTranslation, error) {
	batch := preparedTranslation{}
	wanted := map[string]bool{}
	for _, id := range ids {
		if !validID(id, 64) || wanted[id] {
			return batch, translationFail(400, "翻译区块无效")
		}
		wanted[id] = true
	}
	document, adjacent := []string{}, []string{}
	prior := []map[string]string{}
	matched := 0
	first, last := -1, -1
	for i, g := range plan.Groups {
		kind := g.Regions[0].Kind
		if (kind == "title" || kind == "abstract") && len(document) < 2 {
			document = append(document, truncated(translationSource(g.Text), 800))
		}
		if !wanted[g.ID] {
			continue
		}
		if !g.Translate || g.Text == "" {
			return batch, translationFail(409, "所选区块已调整，请重新读取")
		}
		matched++
		if g.Translation != "" && !replaceExisting {
			continue
		}
		if first < 0 {
			first = i
		}
		last = i
		batch.targets = append(batch.targets, TranslationItem{g.ID, translationSource(g.Text)})
	}
	if matched != len(wanted) {
		return batch, translationFail(409, "原文分组已变化，请重新读取")
	}
	if first >= 0 {
		if first > 0 {
			adjacent = append(adjacent, truncated(translationSource(plan.Groups[first-1].Text), 420))
		}
		if last+1 < len(plan.Groups) {
			adjacent = append(adjacent, truncated(translationSource(plan.Groups[last+1].Text), 420))
		}
		for _, g := range plan.Groups[:first] {
			if g.Translation != "" && g.Translate {
				prior = append(prior, map[string]string{"source": truncated(translationSource(g.Text), 320), "translation": truncated(g.Translation, 320)})
				if len(prior) > 2 {
					prior = prior[1:]
				}
			}
		}
	}
	batch.payload, _ = json.Marshal(map[string]any{"documentContext": document, "adjacentContext": adjacent, "priorTranslations": prior, "targets": batch.targets})
	if len(batch.payload) > 160<<10 {
		return batch, translationFail(400, "当前批次内容过长，请减少选材")
	}
	return batch, nil
}

type translationResponseError struct{ message string }

func (e *translationResponseError) Error() string { return e.message }

func decodeTranslations(raw string, batch preparedTranslation) (map[string]string, error) {
	var output struct {
		Translations []json.RawMessage `json:"translations"`
	}
	if json.Unmarshal([]byte(raw), &output) != nil || output.Translations == nil {
		return nil, &translationResponseError{"模型返回的译文格式不完整"}
	}
	accepted := make(map[string]string, len(batch.targets))
	wanted, seen := map[string]bool{}, map[string]bool{}
	for _, item := range batch.targets {
		wanted[item.ID] = true
	}
	for _, rawEntry := range output.Translations {
		var entry struct {
			ID   string          `json:"id"`
			Text json.RawMessage `json:"text"`
		}
		if json.Unmarshal(rawEntry, &entry) != nil || !wanted[entry.ID] {
			continue
		}
		if seen[entry.ID] {
			delete(accepted, entry.ID)
			continue
		}
		seen[entry.ID] = true
		var text string
		if json.Unmarshal(entry.Text, &text) == nil {
			if value := strings.TrimSpace(text); value != "" && len(value) <= 150000 {
				accepted[entry.ID] = value
			}
		}
	}
	return accepted, nil
}

func validateTranslation(raw string, batch preparedTranslation) (map[string]string, error) {
	accepted, err := decodeTranslations(raw, batch)
	if err != nil {
		return nil, translationFail(502, err.Error())
	}
	if len(accepted) != len(batch.targets) {
		return nil, translationFail(502, "模型返回的段落标识缺失、重复或译文为空")
	}
	return accepted, nil
}

func (w *Workspace) translationPlan(ctx context.Context, paper string) (ReadingPlan, error) {
	w.readerLock.Lock()
	defer w.readerLock.Unlock()
	returnPlan, _, err := w.readReadingPlan(ctx, paper)
	return returnPlan, err
}

func (w *Workspace) saveTranslationBatch(ctx context.Context, paper string, input translateInput, accepted map[string]string) error {
	w.readerLock.Lock()
	defer w.readerLock.Unlock()
	live, _, err := w.readReadingPlan(ctx, paper)
	if err != nil {
		return err
	}
	if input.Revision != nil && live.Revision != *input.Revision {
		return translationFail(409, "解析核对或分组已变化，当前结果未采用")
	}
	if input.Full && len(live.Review) > 0 {
		return translationFail(409, "解析核对状态已变化，请核对后继续翻译")
	}
	matched := 0
	for _, g := range live.Groups {
		if accepted[g.ID] != "" && g.Translate {
			matched++
		}
	}
	if matched != len(accepted) {
		return translationFail(409, "翻译期间原文分组发生变化，当前批次未保存")
	}
	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	onConflict := "DO NOTHING"
	if input.Replace {
		onConflict = "DO UPDATE SET text=excluded.text, model=excluded.model, effort=excluded.effort, saved_at=excluded.saved_at"
	}
	for id, value := range accepted {
		if _, err = tx.ExecContext(ctx, `INSERT INTO reading_translations(paper_id,fingerprint,text,model,effort,saved_at)
            VALUES(?,?,?,?,?,?) ON CONFLICT(paper_id,fingerprint) `+onConflict, paper, id, value, input.Model, input.Effort, now()); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type translationBatchResult struct {
	saved   int
	missing []string
	reason  string
}

func (w *Workspace) translateBatch(ctx context.Context, paper string, input translateInput, run translationRun, partial bool) (translationBatchResult, error) {
	var result translationBatchResult
	plan, err := w.translationPlan(ctx, paper)
	if err != nil {
		return result, err
	}
	if input.Revision != nil && plan.Revision != *input.Revision {
		return result, translationFail(409, "解析核对或分组已变化，请重新读取")
	}
	if input.Full && len(plan.Review) > 0 {
		return result, translationFail(409, "请先完成解析核对")
	}
	batch, err := prepareTranslationWithReplacement(plan, input.Groups, input.Replace)
	if err != nil || len(batch.targets) == 0 {
		return result, err
	}
	batch.freshSession = input.freshSession
	batchCtx, cancel := context.WithTimeout(ctx, 8*time.Minute)
	defer cancel()
	raw, runErr := run(batchCtx, batch)
	if batchCtx.Err() != nil {
		return result, translationFail(502, "翻译已取消或超时，当前请求未保存")
	}
	var accepted map[string]string
	if runErr == nil {
		accepted, runErr = decodeTranslations(raw, batch)
	}
	if runErr != nil {
		var responseErr *translationResponseError
		if !partial || !errors.As(runErr, &responseErr) {
			return result, translationFail(502, runErr.Error())
		}
		result.reason = runErr.Error()
	}
	for _, item := range batch.targets {
		if accepted[item.ID] == "" {
			result.missing = append(result.missing, item.ID)
		}
	}
	if len(result.missing) > 0 && result.reason == "" {
		result.reason = "段落标识缺失、重复或译文为空"
	}
	if !partial && len(result.missing) > 0 {
		return result, translationFail(502, result.reason)
	}
	if len(accepted) > 0 {
		if err := w.saveTranslationBatch(batchCtx, paper, input, accepted); err != nil {
			return result, err
		}
		result.saved = len(accepted)
	}
	return result, nil
}

func (w *Workspace) translateReading(rw http.ResponseWriter, r *http.Request) {
	var input translateInput
	if !readJSON(rw, r, 16<<10, &input) {
		return
	}
	if !validTranslationInput(input, 8) || (input.Replace && (input.Revision == nil || len(input.Groups) != 1)) {
		fail(rw, 400, "请选择模型、有效的思考强度和 1–8 个段落")
		return
	}
	if !w.translationLock.TryLock() {
		fail(rw, 409, "另一个翻译批次正在处理")
		return
	}
	defer w.translationLock.Unlock()
	paper := r.PathValue("id")
	plan, err := w.translationPlan(r.Context(), paper)
	if err != nil {
		databaseError(rw, err)
		return
	}
	if input.Full && len(plan.Review) > 0 {
		fail(rw, 409, "请先完成解析核对")
		return
	}
	batch, err := prepareTranslationWithReplacement(plan, input.Groups, input.Replace)
	if err != nil {
		fail(rw, translationStatus(err), err.Error())
		return
	}
	if len(batch.targets) == 0 {
		respond(rw, 200, plan)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 9*time.Minute)
	defer cancel()
	run, closeRun, err := w.openTranslation(ctx, input)
	if err != nil {
		fail(rw, 503, err.Error())
		return
	}
	defer closeRun()
	if _, err = w.translateBatch(ctx, paper, input, run, false); err != nil {
		fail(rw, translationStatus(err), err.Error())
		return
	}
	updated, err := w.translationPlan(r.Context(), paper)
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, updated)
}

func translationBatches(groups []ReadingGroup) [][]string {
	batches := [][]string{}
	batch := []string{}
	size := 0
	for _, g := range groups {
		if !g.Translate || g.Translation != "" {
			continue
		}
		count := len([]rune(g.Text))
		if len(batch) > 0 && (len(batch) >= 20 || size+count > 16000) {
			batches = append(batches, batch)
			batch = []string{}
			size = 0
		}
		batch = append(batch, g.ID)
		size += count
	}
	if len(batch) > 0 {
		batches = append(batches, batch)
	}
	return batches
}

func (w *Workspace) translateReadingBatches(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Connection         string `json:"connection,omitempty"`
		ConnectionRevision int    `json:"connectionRevision,omitempty"`
		Scope              string `json:"scope"`
		Page               int    `json:"page"`
		Group              string `json:"group,omitempty"`
		Model              string `json:"model"`
		Effort             string `json:"effort"`
		Revision           int    `json:"revision"`
	}
	if !readJSON(rw, r, 4096, &input) {
		return
	}
	settings := translateInput{Groups: []string{""}, Model: input.Model, Effort: input.Effort, Full: input.Scope == "paper", Connection: input.Connection, ConnectionRevision: input.ConnectionRevision, Revision: &input.Revision}
	if !validTranslationInput(settings, 1) || (input.Scope != "paper" && input.Scope != "page" && input.Scope != "one") ||
		input.Scope == "page" && (input.Page < 1 || input.Page > 100000) {
		fail(rw, 400, "翻译范围或模型设置无效")
		return
	}
	if !w.translationLock.TryLock() {
		fail(rw, 409, "另一个翻译任务正在处理")
		return
	}
	defer w.translationLock.Unlock()
	paper := r.PathValue("id")
	plan, err := w.translationPlan(r.Context(), paper)
	if err != nil {
		databaseError(rw, err)
		return
	}
	if plan.Revision != input.Revision {
		fail(rw, 409, "原文分组已变化，请重新读取")
		return
	}
	if settings.Full && len(plan.Review) > 0 {
		fail(rw, 409, "请先完成解析核对")
		return
	}
	selected := []ReadingGroup{}
	for _, g := range plan.Groups {
		include := input.Scope == "paper" || input.Scope == "one" && g.ID == input.Group
		if input.Scope == "page" {
			for _, part := range g.Regions {
				include = include || part.Page == input.Page
			}
		}
		if include {
			selected = append(selected, g)
		}
	}
	if input.Scope == "one" && len(selected) != 1 {
		fail(rw, 409, "所选段落已变化")
		return
	}
	batches := translationBatches(selected)
	total := 0
	for _, batch := range batches {
		total += len(batch)
	}
	// Streaming jobs use their own bounded context and per-batch timeout.
	// The server-wide four-minute deadline must not truncate a long paper.
	_ = http.NewResponseController(rw).SetWriteDeadline(time.Time{})
	rw.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	rw.Header().Set("X-Accel-Buffering", "no")
	encoder := json.NewEncoder(rw)
	var streamLock sync.Mutex
	emit := func(value any) bool {
		streamLock.Lock()
		defer streamLock.Unlock()
		if err := encoder.Encode(value); err != nil {
			return false
		}
		return http.NewResponseController(rw).Flush() == nil
	}
	if !emit(map[string]any{"kind": "start", "total": total, "batches": len(batches)}) {
		return
	}
	if total == 0 {
		emit(map[string]any{"kind": "done", "done": 0, "total": 0})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Hour)
	heartbeatDone := make(chan struct{})
	defer func() { cancel(); <-heartbeatDone }()
	go func() {
		defer close(heartbeatDone)
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
	run, closeRun, err := w.openTranslation(ctx, settings)
	connecting.Stop()
	if err != nil {
		emit(map[string]any{"kind": "error", "message": err.Error()})
		return
	}
	defer closeRun()
	done := 0
	var failed []string
	var failureReason string
	zeroBatches := 0
	for i, ids := range batches {
		if ctx.Err() != nil {
			return
		}
		count, missing, reason, err := w.recoverTranslationBatch(ctx, paper, settings, run, ids)
		done += count
		if !emit(map[string]any{"kind": "batch", "done": done, "total": total, "batch": i + 1, "batches": len(batches), "saved": count}) {
			return
		}
		if err != nil {
			if ctx.Err() == nil {
				emit(map[string]any{"kind": "error", "done": done, "total": total, "message": translationFailureMessage(selected, missing, err.Error())})
			}
			return
		}
		failed = append(failed, missing...)
		if len(missing) > 0 {
			failureReason = reason
		}
		if count == 0 && len(missing) >= 2 {
			zeroBatches++
			if zeroBatches >= 2 && i+1 < len(batches) {
				failureReason += "，其余批次暂未请求模型"
				break
			}
		} else {
			zeroBatches = 0
		}
	}
	if len(failed) > 0 {
		emit(map[string]any{"kind": "error", "done": done, "total": total, "message": translationFailureMessage(selected, failed, failureReason)})
		return
	}
	emit(map[string]any{"kind": "done", "done": done, "total": total})
}

// Recover only missing IDs, with a bounded number of model calls per original batch.
func (w *Workspace) recoverTranslationBatch(ctx context.Context, paper string, input translateInput, run translationRun, ids []string) (int, []string, string, error) {
	queue := [][]string{ids}
	var failed []string
	var reason string
	saved := 0
	const maxAttempts = 5
	for attempt := 0; len(queue) > 0 && attempt < maxAttempts; attempt++ {
		current := queue[0]
		queue = queue[1:]
		input.Groups, input.freshSession = current, attempt > 0
		result, err := w.translateBatch(ctx, paper, input, run, true)
		if err != nil {
			failed = append(failed, current...)
			for _, pending := range queue {
				failed = append(failed, pending...)
			}
			return saved, failed, reason, err
		}
		saved += result.saved
		missing := result.missing
		if len(missing) == 0 {
			continue
		}
		reason = result.reason
		switch {
		case len(missing) == 1 && len(current) == 1 && attempt > 0:
			failed = append(failed, missing...)
		case len(missing) == len(current) && len(missing) > 1:
			middle := len(missing) / 2
			queue = append(queue, missing[:middle], missing[middle:])
		default:
			queue = append(queue, missing)
		}
	}
	for _, pending := range queue {
		failed = append(failed, pending...)
	}
	return saved, failed, reason, nil
}

func translationFailureMessage(groups []ReadingGroup, ids []string, reason string) string {
	if len(ids) == 0 {
		return reason
	}
	wanted := map[string]bool{}
	for _, id := range ids {
		wanted[id] = true
	}
	var locations []string
	for _, group := range groups {
		if wanted[group.ID] && len(group.Regions) > 0 {
			page := group.Regions[0].Page
			end := group.Regions[len(group.Regions)-1].Page
			number := fmt.Sprint(page)
			if end != page {
				number += "–" + fmt.Sprint(end)
			}
			locations = append(locations, fmt.Sprintf("第 %s 页「%s」", number, truncated(translationSource(group.Text), 38)))
			if len(locations) == 3 {
				break
			}
		}
	}
	note := fmt.Sprintf("%d 段未保存", len(ids))
	if len(locations) > 0 {
		note += " · " + strings.Join(locations, "、")
	}
	return note + "。" + reason + "。重试会从未保存部分继续。"
}

func truncated(value string, n int) string {
	r := []rune(value)
	if len(r) > n {
		return string(r[:n])
	}
	return value
}

package workspace

import (
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
)

func (w *Workspace) Handler(host, token string) http.Handler {
	routes := http.NewServeMux()
	routes.HandleFunc("GET /health", func(rw http.ResponseWriter, _ *http.Request) {
		respond(rw, 200, map[string]int{"schema": schemaVersion})
	})
	routes.HandleFunc("GET /papers", w.listPapers)
	routes.HandleFunc("POST /papers/import", w.importPaper)
	routes.HandleFunc("POST /import/lookup", w.lookupOnline)
	routes.HandleFunc("POST /import/download", w.importOnline)
	routes.HandleFunc("GET /papers/{id}/pdf", w.pdf)
	routes.HandleFunc("PATCH /papers/{id}", w.updatePaper)
	routes.HandleFunc("POST /papers/{id}/metadata", w.enrichPaperMetadata)
	routes.HandleFunc("PUT /papers/{id}/position", w.savePosition)
	routes.HandleFunc("PUT /papers/{id}/preview-info", w.savePreviewInfo)
	routes.HandleFunc("PATCH /papers/{id}/remark", w.savePaperRemark)
	routes.HandleFunc("GET /papers/{id}/export", w.exportSnapshot)
	routes.HandleFunc("POST /exports/render/{format}", w.renderExport)
	routes.HandleFunc("GET /papers/{id}/marks", w.listMarks)
	routes.HandleFunc("POST /papers/{id}/marks", w.createMark)
	routes.HandleFunc("PATCH /papers/{id}/marks/{mark}", w.commentMark)
	routes.HandleFunc("PUT /papers/{id}/marks/{mark}", w.updateAnnotation)
	routes.HandleFunc("DELETE /papers/{id}/marks/{mark}", w.removeMark)
	routes.HandleFunc("GET /papers/{id}/parse/{page}/{engine}", w.readParse)
	routes.HandleFunc("POST /papers/{id}/parse/{page}/{engine}", w.saveParse)
	routes.HandleFunc("GET /papers/{id}/reading", w.readingPlan)
	routes.HandleFunc("PUT /papers/{id}/reading/pages/{page}", w.saveReadingPage)
	routes.HandleFunc("PATCH /papers/{id}/reading", w.editReading)
	routes.HandleFunc("PUT /papers/{id}/reading/pages/{page}/flow", w.saveReadingFlow)
	routes.HandleFunc("GET /papers/{id}/stage-summary", w.readStageSummary)
	routes.HandleFunc("GET /paper-jobs", w.listPaperJobs)
	routes.HandleFunc("POST /paper-jobs/recover", w.recoverPaperJobClient)
	routes.HandleFunc("POST /papers/{id}/jobs/{stage}", w.paperJob)
	routes.HandleFunc("GET /translation/connection", w.readCodexConnection)
	routes.HandleFunc("PUT /translation/connection", w.saveCodexConnection)
	routes.HandleFunc("GET /translation/models", w.listTranslationModels)
	routes.HandleFunc("GET /translation/connections", w.translationConnections)
	routes.HandleFunc("POST /translation/connections", w.saveTranslationConnection)
	routes.HandleFunc("POST /translation/test", w.testTranslation)
	routes.HandleFunc("GET /translation/buddy-login", w.buddyLoginCommand)
	routes.HandleFunc("POST /papers/{id}/reading/translate", w.translateReading)
	routes.HandleFunc("POST /papers/{id}/reading/translate-batches", w.translateReadingBatches)
	routes.HandleFunc("POST /papers/{id}/reading/merge-translate", w.mergeAndTranslate)
	routes.HandleFunc("GET /notes", w.listNotes)
	routes.HandleFunc("POST /notes", w.createNote)
	routes.HandleFunc("PATCH /notes/{id}", w.editNote)
	routes.HandleFunc("GET /notes/{id}/history", w.noteHistory)
	routes.HandleFunc("GET /companion", w.companionSnapshot)
	routes.HandleFunc("POST /research/tasks", w.createResearchTask)
	routes.HandleFunc("GET /research/tasks/{id}/source", w.researchSource)
	routes.HandleFunc("POST /focus/command", w.focusCommand)
	routes.HandleFunc("GET /planner", w.plannerBoard)
	routes.HandleFunc("POST /planner/action", w.plannerAction)
	routes.HandleFunc("GET /agenda", w.listAgenda)
	routes.HandleFunc("POST /agenda", w.saveAgenda)
	routes.HandleFunc("PATCH /agenda/{id}", w.saveAgenda)
	routes.HandleFunc("GET /projects", w.listProjects)
	routes.HandleFunc("POST /projects", w.saveProject)
	routes.HandleFunc("PATCH /projects/{id}", w.saveProject)
	routes.HandleFunc("GET /projects/{id}/materials", w.projectMaterials)
	routes.HandleFunc("PUT /projects/{id}/materials/{kind}/{target}", w.changeProjectMaterial)
	routes.HandleFunc("DELETE /projects/{id}/materials/{kind}/{target}", w.changeProjectMaterial)
	routes.HandleFunc("GET /goals", w.listGoals)
	routes.HandleFunc("POST /goals", w.saveGoal)
	routes.HandleFunc("PATCH /goals/{id}", w.saveGoal)
	routes.HandleFunc("GET /goals/{id}/history", w.goalHistory)
	routes.HandleFunc("GET /courses", w.listCourses)
	routes.HandleFunc("POST /courses", w.saveCourse)
	routes.HandleFunc("PATCH /courses/{id}", w.saveCourse)
	routes.HandleFunc("GET /courses/{course}/chapters", w.listChapters)
	routes.HandleFunc("POST /courses/{course}/chapters", w.saveChapter)
	routes.HandleFunc("PATCH /courses/{course}/chapters/{id}", w.saveChapter)
	routes.HandleFunc("GET /chapters/{chapter}/records", w.listStudy)
	routes.HandleFunc("POST /chapters/{chapter}/records", w.saveStudy)
	routes.HandleFunc("GET /experiments", w.listExperiments)
	routes.HandleFunc("POST /experiments", w.saveExperiment)
	routes.HandleFunc("PATCH /experiments/{id}", w.saveExperiment)
	routes.HandleFunc("GET /experiments/{experiment}/runs", w.listRuns)
	routes.HandleFunc("POST /experiments/{experiment}/runs", w.saveRun)
	routes.HandleFunc("PATCH /experiments/{experiment}/runs/{id}", w.saveRun)
	routes.HandleFunc("GET /life", w.listLife)
	routes.HandleFunc("POST /life", w.saveLife)
	routes.HandleFunc("PATCH /life/{id}", w.saveLife)
	routes.HandleFunc("POST /life/water", w.updateWater)
	routes.HandleFunc("GET /words", w.listWords)
	routes.HandleFunc("POST /words", w.createWord)
	routes.HandleFunc("POST /words/capture", w.captureWord)
	routes.HandleFunc("PUT /words/{id}/meaning", w.updateWordMeaning)
	routes.HandleFunc("PATCH /words/{id}", w.reviewWord)
	return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Cache-Control", "no-store")
		rw.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Host != host || r.Header.Get("Origin") != "" ||
			subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			fail(rw, 403, "桌面会话无效")
			return
		}
		if id := strings.Split(strings.TrimPrefix(r.URL.Path, "/papers/"), "/")[0]; strings.HasPrefix(r.URL.Path, "/papers/") && id != "import" && !validID(id, 64) {
			fail(rw, 404, "找不到文献")
			return
		}
		routes.ServeHTTP(rw, r)
	})
}

func respond(rw http.ResponseWriter, status int, value any) {
	rw.Header().Set("Content-Type", "application/json; charset=utf-8")
	rw.WriteHeader(status)
	_ = json.NewEncoder(rw).Encode(value)
}
func fail(rw http.ResponseWriter, status int, message string) {
	respond(rw, status, map[string]string{"error": message})
}
func databaseError(rw http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		fail(rw, 404, "记录不存在或已移入回收站")
		return
	}
	log.Print(err)
	fail(rw, 500, "本地存储操作失败")
}
func readJSON(rw http.ResponseWriter, r *http.Request, limit int64, dst any) bool {
	r.Body = http.MaxBytesReader(rw, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil || dec.Decode(new(any)) != io.EOF {
		fail(rw, 400, "请求内容无效")
		return false
	}
	return true
}
func validID(value string, size int) bool {
	if len(value) != size || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
func pageNumber(r *http.Request) int {
	page, _ := strconv.Atoi(r.PathValue("page"))
	return page
}

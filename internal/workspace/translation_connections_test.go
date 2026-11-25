package workspace

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
)

func TestAPITranslationConnectionRequiresSnapshotAndValidResult(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	const key = "isolated-translation-test-key"
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if runtime.GOOS == "windows" && r.Header.Get("Authorization") != "Bearer "+key {
			http.Error(rw, "unauthorized", 401)
			return
		}
		if r.URL.Path == "/v1/models" {
			_ = json.NewEncoder(rw).Encode(map[string]any{"data": []map[string]string{{"id": "test-api"}}})
			return
		}
		if r.URL.Path != "/v1/chat/completions" || r.Method != "POST" {
			http.NotFound(rw, r)
			return
		}
		var body struct {
			Model    string              `json:"model"`
			Messages []map[string]string `json:"messages"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Messages) != 2 {
			http.Error(rw, "request", 400)
			return
		}
		var payload struct {
			Targets []TranslationItem `json:"targets"`
		}
		if json.Unmarshal([]byte(body.Messages[1]["content"]), &payload) != nil {
			http.Error(rw, "payload", 400)
			return
		}
		for idx := range payload.Targets {
			payload.Targets[idx].Text = "保留原文中的标记：" + payload.Targets[idx].Text
		}
		if body.Model == "invalid" {
			payload.Targets[0].ID = "unexpected"
		}
		content, _ := json.Marshal(map[string]any{"translations": payload.Targets})
		_ = json.NewEncoder(rw).Encode(map[string]any{"choices": []any{
			map[string]any{"finish_reason": "stop", "message": map[string]string{"content": string(content)}},
		}})
	}))
	defer upstream.Close()

	input := map[string]any{"name": "Fixture", "baseURL": upstream.URL + "/v1"}
	if runtime.GOOS == "windows" {
		input["key"] = key
	}
	post := func(path string, value any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(value)
		return request(t, h, "POST", path, string(raw), nil)
	}
	conn := post("/translation/connections", input)
	if conn.Code != 200 || strings.Contains(conn.Body.String(), key) {
		t.Fatal(conn.Code, conn.Body.String())
	}
	var saved translationConnection
	if err := json.Unmarshal(conn.Body.Bytes(), &saved); err != nil || saved.Revision != 1 {
		t.Fatal(err, saved)
	}
	if runtime.GOOS == "windows" {
		var stored []byte
		err = w.db.QueryRow("SELECT secret FROM translation_connections WHERE id=?", saved.ID).Scan(&stored)
		if err != nil || len(stored) == 0 || strings.Contains(string(stored), key) || !saved.HasKey {
			t.Fatal("expected encrypted key")
		}
	}
	models := request(t, h, "GET", "/translation/models?connection="+saved.ID+"&revision=1", "", nil)
	if models.Code != 200 || !strings.Contains(models.Body.String(), "test-api") {
		t.Fatal(models.Code, models.Body.String())
	}
	translation := translateInput{Connection: saved.ID, ConnectionRevision: 1, Model: "test-api"}
	res := post("/translation/test", translation)
	if res.Code != 200 || !strings.Contains(res.Body.String(), "保留原文") {
		t.Fatal(res.Code, res.Body.String())
	}
	translation.Model = "invalid"
	if res = post("/translation/test", translation); res.Code != 502 {
		t.Fatal(res.Code, res.Body.String())
	}

	if updated := post("/translation/connections", map[string]any{"id": saved.ID, "name": "Renamed", "baseURL": saved.BaseURL, "revision": 1}); updated.Code != 200 {
		t.Fatal(updated.Code, updated.Body.String())
	}
	fresh := translation
	fresh.Model, fresh.ConnectionRevision = "test-api", 2
	if result := post("/translation/test", fresh); result.Code != 200 {
		t.Fatal("editing a name lost the key", result.Code, result.Body.String())
	}
	before := calls.Load()
	if res = post("/translation/test", translation); res.Code != 503 || calls.Load() != before {
		t.Fatal("stale connection sent a request", res.Code)
	}
}

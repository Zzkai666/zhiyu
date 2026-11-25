package workspace

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testHost = "127.0.0.1:18710"
const testToken = "workspace-test-token"

func request(t *testing.T, handler http.Handler, method, path, data string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://"+testHost+path, strings.NewReader(data))
	r.Header.Set("Authorization", "Bearer "+testToken)
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, r)
	return response
}

func importFixture(t *testing.T, handler http.Handler, body string) (Paper, bool, int) {
	t.Helper()
	result := request(t, handler, "POST", "/papers/import", body, map[string]string{"X-Paper-Title": url.PathEscape("中文测试.pdf")})
	var output struct {
		Paper     Paper
		Duplicate bool
	}
	if result.Code == 200 || result.Code == 201 {
		if err := json.Unmarshal(result.Body.Bytes(), &output); err != nil {
			t.Fatal(err)
		}
	}
	return output.Paper, output.Duplicate, result.Code
}

func TestIndependentWorkspaceAndPaper(t *testing.T) {
	root := t.TempDir()
	w, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	if competing, err := Open(root); err == nil {
		competing.Close()
		t.Fatal("opened a workspace twice")
	}
	handler := w.Handler(testHost, testToken)
	if r := request(t, handler, "GET", "/health", "", map[string]string{"Authorization": "wrong"}); r.Code != 403 {
		t.Fatal(r.Code)
	}
	if r := request(t, handler, "GET", "/health", "", map[string]string{"Origin": "https://example.org"}); r.Code != 403 {
		t.Fatal(r.Code)
	}
	if _, _, code := importFixture(t, handler, "bad file"); code != 400 {
		t.Fatal(code)
	}
	original := "%PDF-1.7\nfixture data"
	paper, duplicate, code := importFixture(t, handler, original)
	if code != 201 || duplicate || paper.Title != "中文测试" {
		t.Fatalf("%+v %v %d", paper, duplicate, code)
	}
	same, duplicate, code := importFixture(t, handler, original)
	if code != 200 || !duplicate || same.ID != paper.ID {
		t.Fatalf("%+v %v %d", same, duplicate, code)
	}
	path := "/papers/" + paper.ID
	if r := request(t, handler, "GET", path+"/pdf", "", map[string]string{"Range": "bytes=0-4"}); r.Code != 206 || r.Body.String() != "%PDF-" {
		t.Fatal(r.Code, r.Body)
	}
	if r := request(t, handler, "PUT", path+"/position", `{"page":3,"zoom":130}`, nil); r.Code != 200 {
		t.Fatal(r.Code, r.Body)
	}
	if r := request(t, handler, "POST", path+"/marks", `{"page":3,"kind":"bookmark","color":"amber","quote":"","rects":[]}`, nil); r.Code != 201 {
		t.Fatal(r.Code, r.Body)
	}
	if r := request(t, handler, "POST", path+"/marks", `{"page":3,"kind":"bookmark","color":"amber","quote":"","rects":[]}`, nil); r.Code != 409 {
		t.Fatal(r.Code, r.Body)
	}
	if r := request(t, handler, "POST", path+"/parse/3/layout-v2", `[{"kind":"table","text":"","rect":{"x":0.1,"y":0.2,"w":0.7,"h":0.5}}]`, nil); r.Code != 201 {
		t.Fatal(r.Code, r.Body)
	}
	if r := request(t, handler, "POST", path+"/parse/3/layout-v2", `[{"kind":"table","text":"","rect":{"x":0.8,"y":0.2,"w":0.7,"h":0.5}}]`, nil); r.Code != 400 {
		t.Fatal(r.Code, r.Body)
	}
	if r := request(t, handler, "GET", path+"/parse/3/layout-v2", "", nil); r.Code != 200 || !bytes.Contains(r.Body.Bytes(), []byte(`"kind":"table"`)) {
		t.Fatal(r.Code, r.Body)
	}
	w.Close()
	reopened, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if r := request(t, reopened.Handler(testHost, testToken), "GET", "/papers", "", nil); r.Code != 200 || !bytes.Contains(r.Body.Bytes(), []byte(`"page":3,"zoom":130`)) {
		t.Fatal(r.Code, r.Body)
	}
}

func TestRejectsLegacyWorkspace(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "researchdesk.sqlite3")
	if err := os.WriteFile(old, []byte("legacy"), 0600); err != nil {
		t.Fatal(err)
	}
	if w, err := Open(root); err == nil {
		w.Close()
		t.Fatal("accepted previous workspace")
	}
	if data, err := os.ReadFile(old); err != nil || string(data) != "legacy" {
		t.Fatal(data, err)
	}
	if _, err := os.Stat(filepath.Join(root, "researchdesk-next.sqlite")); !os.IsNotExist(err) {
		t.Fatal("created a new file in legacy workspace")
	}
}

func TestNoteSourceAndHistory(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	handler := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, handler, "%PDF-1.7\nexample")
	input := Note{Title: "阅读笔记", Body: "first", PaperID: paper.ID, Page: 3, Quote: "固定原文"}
	data, _ := json.Marshal(input)
	r := request(t, handler, "POST", "/notes", string(data), nil)
	if r.Code != 201 {
		t.Fatal(r.Code, r.Body)
	}
	var n Note
	if err := json.Unmarshal(r.Body.Bytes(), &n); err != nil {
		t.Fatal(err)
	}
	n.Body = "second"
	n.Page = 5
	data, _ = json.Marshal(n)
	path := "/notes/" + n.ID
	r = request(t, handler, "PATCH", path, string(data), nil)
	if r.Code != 200 || !strings.Contains(r.Body.String(), `"page":3`) {
		t.Fatal(r.Code, r.Body)
	}
	r = request(t, handler, "PATCH", path, string(data), nil)
	if r.Code != 409 {
		t.Fatal(r.Code, r.Body)
	}
	r = request(t, handler, "GET", path+"/history", "", nil)
	if r.Code != 200 || !strings.Contains(r.Body.String(), `"body":"first"`) {
		t.Fatal(r.Code, r.Body)
	}
}

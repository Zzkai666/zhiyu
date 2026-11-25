package workspace

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestLocalMetadataUsesRealTitleWithoutOverwritingLaterManualRename(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, h, "%PDF-1.7\nmetadata")
	body := map[string]any{"revision": 1, "title": "A real paper title", "authors": "Ada Researcher", "year": 2025, "text": "arXiv:2510.07077v1", "online": false}
	response := sendJSON(t, h, http.MethodPost, "/papers/"+paper.ID+"/metadata", body, 200)
	var saved Paper
	_ = json.Unmarshal(*response, &saved)
	if saved.Title != "A real paper title" || saved.Metadata.Arxiv != "2510.07077v1" || saved.Metadata.URL != "https://arxiv.org/abs/2510.07077v1" {
		t.Fatal(saved)
	}
	_, err = w.db.Exec("UPDATE papers SET title='My own title',revision=revision+1 WHERE id=?", paper.ID)
	if err != nil {
		t.Fatal(err)
	}
	body["revision"] = saved.Revision + 1
	response = sendJSON(t, h, http.MethodPost, "/papers/"+paper.ID+"/metadata", body, 200)
	_ = json.Unmarshal(*response, &saved)
	if saved.Title != "My own title" {
		t.Fatal("manual title overwritten")
	}
	sendJSON(t, h, http.MethodPost, "/papers/"+paper.ID+"/metadata", body, 409)
}

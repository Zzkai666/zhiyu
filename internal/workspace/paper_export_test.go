package workspace

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"image"
	"image/png"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestExportUsesSavedMergedParagraphAndIncludesFiguresAndReferences(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, h, "%PDF-1.7\nexport")
	b := "/papers/" + paper.ID
	sendJSON(t, h, "PUT", b+"/reading/pages/1", []Region{{Kind: "title", Text: "Source title", Rect: Rect{.1, .1, .7, .1}}, {Kind: "text", Text: "First fragment", Rect: Rect{.1, .4, .4, .2}}, {Kind: "figure", Rect: Rect{.6, .4, .3, .2}}, {Kind: "margin", Text: "RUNNING HEAD", Rect: Rect{.1, .02, .7, .02}}}, 200)
	sendJSON(t, h, "PUT", b+"/reading/pages/2", []Region{{Kind: "text", Text: "second fragment.", Rect: Rect{.1, .1, .4, .2}}, {Kind: "reference", Text: "[1] Original reference.", Rect: Rect{.1, .5, .7, .1}}}, 200)
	raw := request(t, h, "GET", b+"/reading", "", nil)
	var plan ReadingPlan
	json.Unmarshal(raw.Body.Bytes(), &plan)
	sendJSON(t, h, "PATCH", b+"/reading", map[string]any{"revision": plan.Revision, "action": "join", "first": "p1-b2", "selected": []string{"p1-b2", "p2-b1"}}, 200)
	plan, _, _ = w.readReadingPlan(t.Context(), paper.ID)
	var joined ReadingGroup
	for _, g := range plan.Groups {
		if len(g.Regions) == 2 {
			joined = g
		}
	}
	if joined.ID == "" {
		t.Fatal("missing merged paragraph")
	}
	_, err = w.db.Exec("INSERT INTO reading_translations VALUES(?,?,?,?,?,?)", paper.ID, joined.ID, "唯一完整译文，x^{2} 与 H_{2}O。", "fixture", "medium", "saved")
	if err != nil {
		t.Fatal(err)
	}
	raw = request(t, h, "GET", b+"/export", "", nil)
	if raw.Code != 200 {
		t.Fatal(raw.Body.String())
	}
	var snap ExportSnapshot
	json.Unmarshal(raw.Body.Bytes(), &snap)
	if snap.Translated != 1 || snap.Pending != 1 {
		t.Fatal(snap.Translated, snap.Pending)
	}
	var img bytes.Buffer
	png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 20, 10)))
	var picture string
	for _, g := range snap.Plan.Groups {
		if exportVisual(g.Regions[0].Kind) {
			picture = g.ID
		}
	}
	input := ExportRender{Snapshot: snap, Assets: []ExportAsset{{ID: picture, PNG: base64.StdEncoding.EncodeToString(img.Bytes())}}, AssetPrefix: "paper-assets-test"}
	images, err := exportImages(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = exportHTML(input, images); err == nil {
		t.Fatal("partial paper exported as complete")
	}
	input.IncludeUntranslated = true
	text, err := exportHTML(input, images)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(text, "唯一完整译文") != 1 || strings.Contains(text, "First fragment") || strings.Contains(text, "RUNNING HEAD") || !strings.Contains(text, "Original reference") || !strings.Contains(text, "未翻译") || !strings.Contains(text, "<sup>2</sup>") {
		t.Fatal(text)
	}
	docx, err := exportDOCX(input, images)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(docx), int64(len(docx)))
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string][]byte{}
	for _, f := range archive.File {
		r, _ := f.Open()
		data, _ := io.ReadAll(r)
		r.Close()
		entries[f.Name] = data
		if strings.HasSuffix(f.Name, ".xml") || strings.HasSuffix(f.Name, ".rels") {
			decoder := xml.NewDecoder(bytes.NewReader(data))
			for {
				_, err = decoder.Token()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Fatal(f.Name, err)
				}
			}
		}
	}
	xmlDoc := string(entries["word/document.xml"])
	if strings.Count(xmlDoc, "唯一完整译文") != 1 || !strings.Contains(xmlDoc, "w:vertAlign") || entries["word/media/image-001.png"] == nil {
		t.Fatal(xmlDoc)
	}
	md, err := exportMarkdown(input, images)
	if err != nil || !strings.Contains(md, "./paper-assets-test/image-001.png") {
		t.Fatal(md, err)
	}
	input.Assets = append(input.Assets, input.Assets[0])
	if _, err = exportImages(input); err == nil {
		t.Fatal("duplicate asset accepted")
	}
	var count int
	w.db.QueryRow("SELECT count(*) FROM reading_translations").Scan(&count)
	if count != 1 {
		t.Fatal("export changed saved translations")
	}
	request(t, h, http.MethodGet, b+"/export", "", nil)
}
func TestExportEscapesUntrustedPaperText(t *testing.T) {
	input := ExportRender{Snapshot: ExportSnapshot{Paper: Paper{Title: "<script>metadata</script>"}, Plan: ReadingPlan{Groups: []ReadingGroup{{Text: "x", Translate: true, Translation: "<img src=https://example.com onerror=alert(1)>", Regions: []Region{{Kind: "text"}}}}}}, IncludeUntranslated: true}
	text, err := exportHTML(input, nil)
	if err != nil || strings.Contains(text, "<script>") || strings.Contains(text, "<img src=https:") {
		t.Fatal(text, err)
	}
}

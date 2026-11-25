package workspace

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func TestCachedWatermarkCleanupKeepsRegionAndPriorTranslation(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, h, "%PDF-1.7\nlegacy review fixture")
	rawRegion := Region{Kind: "text", Rect: Rect{.08, .2, .38, .3}, Text: "A complete paragraph about control systems [5]–[7]. arXiv:2510.07077v1 [cs.RO] 8 Oct 2025"}
	data, _ := json.Marshal([]Region{rawRegion})
	if _, err = w.db.Exec("INSERT INTO reading_pages VALUES(?,?,?)", paper.ID, 1, string(data)); err != nil {
		t.Fatal(err)
	}
	old := rawRegion
	old.ID, old.Page, old.Translate = "p1-b1", 1, true
	identity, _ := json.Marshal([]Region{old})
	sum := sha256.Sum256(identity)
	fingerprint := hex.EncodeToString(sum[:])
	if _, err = w.db.Exec("INSERT INTO reading_translations VALUES(?,?,?,?,?,?)", paper.ID, fingerprint, "旧的完整译文", "fixture", "medium", now()); err != nil {
		t.Fatal(err)
	}
	plan, _, err := w.readReadingPlan(t.Context(), paper.ID)
	if err != nil {
		t.Fatal(err)
	}
	g := plan.Groups[0]
	if g.Text != "A complete paragraph about control systems [5]–[7]." || g.Regions[0].ID != "p1-b1" ||
		g.PriorTranslation != "旧的完整译文" || g.Translation != "" || g.ID == fingerprint {
		t.Fatalf("invalid recovery: %+v", g)
	}
	var stored string
	if err = w.db.QueryRow("SELECT blocks FROM reading_pages WHERE paper_id=?", paper.ID).Scan(&stored); err != nil || stored != string(data) {
		t.Fatal("raw cache changed", err)
	}
	// User category overrides still apply to the original region identity.
	edits := ReadingEdits{Regions: map[string]RegionEdit{"p1-b1": {Kind: "author"}}}
	current := makeReadingPlan([]int{1}, []Region{old}, edits, 4)
	if current.Groups[0].Regions[0].Kind != "author" || current.Revision != 4 {
		t.Fatal("manual correction lost")
	}
	tail := Region{ID: "p1-b2", Page: 1, Kind: "text", Text: "This is the continuation explicitly chosen by the user.", Rect: Rect{.08, .52, .38, .1}}
	joined := makeReadingPlan([]int{1}, []Region{old, tail}, ReadingEdits{Joins: []Join{{From: "p1-b1", To: "p1-b2"}}}, 7)
	if len(joined.Groups) != 1 || len(joined.Groups[0].Regions) != 2 || joined.Revision != 7 {
		t.Fatal("manual paragraph connection lost")
	}
}

func TestCleanupPreservesOrdinaryArxivReferences(t *testing.T) {
	r := Region{Kind: "text", Page: 2, Rect: Rect{.08, .2, .38, .3}, Text: "Our model follows arXiv:2510.07077v1 [cs.RO] 8 Oct 2025"}
	if cleanCachedRegion(r) != r {
		t.Fatal("non-first-page source changed")
	}
	r.Page = 1
	r.Kind = "reference"
	if cleanCachedRegion(r) != r {
		t.Fatal("bibliographic citation changed")
	}
}

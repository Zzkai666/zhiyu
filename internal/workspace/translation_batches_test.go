package workspace

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestTranslationBatchesKeepWholeParagraphsAndSkipSaved(t *testing.T) {
	groups := []ReadingGroup{}
	for i := 0; i < 45; i++ {
		groups = append(groups, ReadingGroup{ID: strings.Repeat("a", 63) + string(rune('A'+i)), Text: strings.Repeat("中", 790), Translate: true})
	}
	groups[0].Translation = "已经保存"
	groups[1].Translate = false
	batches := translationBatches(groups)
	if len(batches) != 3 || len(batches[0]) != 20 || len(batches[1]) != 20 || len(batches[2]) != 3 {
		t.Fatalf("%v", batches)
	}
	groups = []ReadingGroup{{ID: "long", Text: strings.Repeat("a", 17000), Translate: true}, {ID: "short", Text: "Complete paragraph", Translate: true}}
	batches = translationBatches(groups)
	if len(batches) != 2 || batches[0][0] != "long" || batches[1][0] != "short" {
		t.Fatal("paragraph split or byte/character budget incorrect")
	}
}

func TestTranslationBatchValidationIsAtomicAndContextBounded(t *testing.T) {
	id := strings.Repeat("a", 64)
	group := ReadingGroup{ID: id, Text: "Compare α with Fig. 2 and [3].", Translate: true, Regions: []Region{{Kind: "text"}}}
	batch, err := prepareTranslation(ReadingPlan{Groups: []ReadingGroup{group}}, []string{id})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = validateTranslation("{\"translations\":[]}", batch); err == nil {
		t.Fatal("missing target accepted")
	}
	if batch.targets[0].Text != group.Text || strings.Contains(string(batch.payload), "RD_M") {
		t.Fatal("the model did not receive the full source", string(batch.payload))
	}
	if _, err = validateTranslation("{\"translations\":[{\"id\":\""+id+"\",\"text\":\"保留此段对应关系\"}]}", batch); err != nil {
		t.Fatal("content differences should not block matching paragraphs", err)
	}
	if _, err = prepareTranslation(ReadingPlan{Groups: []ReadingGroup{group}}, []string{id, id}); err == nil {
		t.Fatal("duplicate target accepted")
	}
	group.Translation = "已保存"
	saved, err := prepareTranslation(ReadingPlan{Groups: []ReadingGroup{group}}, []string{id})
	if err != nil || len(saved.targets) != 0 {
		t.Fatal("saved paragraph regenerated")
	}
}

func TestPDFTranslationClosesWordHyphenGaps(t *testing.T) {
	const input = "architec- ture; state -of- the- art; x - y; 4 - 7; α² + v_{m} ≤ 4; (Fig. 3) [12]"
	const want = "architec-ture; state-of-the-art; x - y; 4 - 7; α² + v_{m} ≤ 4; (Fig. 3) [12]"
	if got := translationSource(input); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestTranslationKeepsUnambiguousIDs(t *testing.T) {
	batch := preparedTranslation{targets: []TranslationItem{{ID: "a"}, {ID: "b"}, {ID: "c"}, {ID: "d"}}}
	raw, _ := json.Marshal(map[string]any{"translations": []map[string]any{
		{"id": "b", "text": "valid"},
		{"id": "a", "text": "first copy"},
		{"id": "unrelated", "text": "from a previous turn"},
		{"id": "c", "text": " "},
		{"id": "a", "text": "second copy"},
		{"id": "d", "text": 84},
	}})
	accepted, err := decodeTranslations(string(raw), batch)
	if err != nil || len(accepted) != 1 || accepted["b"] != "valid" {
		t.Fatal(accepted, err)
	}
	if _, err = validateTranslation(string(raw), batch); err == nil {
		t.Fatal("strict single-request validator accepted an ambiguous result")
	}
}

func TestTranslationRecoveryPersistsGoodParagraphsAndRetriesOnlyMissing(t *testing.T) {
	w, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	h := w.Handler(testHost, testToken)
	paper, _, _ := importFixture(t, h, "%PDF-1.7 translation recovery")
	regions := []Region{
		{Kind: "text", Rect: Rect{.1, .2, .7, .04}, Text: "Compare α² ≤ 4 as shown in Fig. 3 [12]."},
		{Kind: "text", Rect: Rect{.1, .4, .7, .04}, Text: "The untreated group was smaller."},
		{Kind: "text", Rect: Rect{.1, .6, .7, .04}, Text: "The architecture is shown here."},
	}
	response := request(t, h, "PUT", "/papers/"+paper.ID+"/reading/pages/1", jobBody(regions), nil)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	plan, err := w.translationPlan(t.Context(), paper.ID)
	if err != nil || len(plan.Groups) != 3 {
		t.Fatal(plan.Groups, err)
	}
	ids := []string{plan.Groups[0].ID, plan.Groups[1].ID, plan.Groups[2].ID}
	input := translateInput{Model: "fixture-model", Revision: &plan.Revision}
	calls := 0
	run := func(_ context.Context, b preparedTranslation) (string, error) {
		calls++
		if calls == 1 {
			if b.targets[0].Text != regions[0].Text {
				t.Fatal(b.targets)
			}
			return jobBody(map[string]any{"translations": []TranslationItem{{ids[2], "第三段"}, {ids[0], "第一段"}}}), nil
		}
		if len(b.targets) != 1 || b.targets[0].ID != ids[1] || !b.freshSession {
			t.Fatal(b.targets, b.freshSession)
		}
		partial, e := w.translationPlan(t.Context(), paper.ID)
		if e != nil || partial.Groups[0].Translation != "第一段" || partial.Groups[2].Translation != "第三段" {
			t.Fatal(partial.Groups, e)
		}
		return jobBody(map[string]any{"translations": []TranslationItem{{ids[1], "第二段"}}}), nil
	}
	saved, failed, _, err := w.recoverTranslationBatch(t.Context(), paper.ID, input, run, ids)
	if err != nil || saved != 3 || len(failed) != 0 || calls != 2 {
		t.Fatal(saved, failed, calls, err)
	}
	// An invalid replacement leaves the previous text intact; a validated one adopts the same ID.
	input.Groups, input.Replace = []string{ids[0]}, true
	invalid := func(context.Context, preparedTranslation) (string, error) { return "{\"translations\":[]}", nil }
	if _, err = w.translateBatch(t.Context(), paper.ID, input, invalid, false); err == nil {
		t.Fatal("accepted a missing replacement")
	}
	still, _ := w.translationPlan(t.Context(), paper.ID)
	if still.Groups[0].Translation != "第一段" {
		t.Fatal(still.Groups[0])
	}
	replacement := func(context.Context, preparedTranslation) (string, error) {
		return jobBody(map[string]any{"translations": []TranslationItem{{ids[0], "新的第一段"}}}), nil
	}
	if _, err = w.translateBatch(t.Context(), paper.ID, input, replacement, false); err != nil {
		t.Fatal(err)
	}
	final, err := w.translationPlan(t.Context(), paper.ID)
	if err != nil || final.Groups[0].ID != ids[0] || final.Groups[0].Translation != "新的第一段" || final.Groups[1].Translation != "第二段" {
		t.Fatal(final.Groups, err)
	}
}

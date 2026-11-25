// A local JSONL fixture for the Electron smoke test. It never calls a model.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func main() {
	switch filepath.Base(os.Args[0]) {
	case "DeepSeek Harness.exe":
		fixtureHarness()
		return
	case "codebuddy.exe":
		fixtureBuddy()
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		v := filepath.Base(filepath.Dir(os.Args[0]))
		if v != "10.0.0" && v != "1.0.0" {
			v = "1.0.0"
		}
		fmt.Println("codex-cli " + v)
		return
	}
	scan := bufio.NewScanner(os.Stdin)
	scan.Buffer(make([]byte, 4096), 2<<20)
	enc := json.NewEncoder(os.Stdout)
	token := regexp.MustCompile(`\[\[RD_M[0-9]+\]\]`)
	for scan.Scan() {
		var req struct {
			ID     json.RawMessage
			Method string
			Params json.RawMessage
		}
		if path := os.Getenv("RDNEXT_CODEX_EVENTS"); path != "" {
			file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
			if err == nil {
				var event map[string]any
				_ = json.Unmarshal(scan.Bytes(), &event)
				event["pid"] = os.Getpid()
				_ = json.NewEncoder(file).Encode(event)
				_ = file.Close()
			}
		}
		if json.Unmarshal(scan.Bytes(), &req) != nil {
			return
		}
		reply := func(value any) { _ = enc.Encode(map[string]any{"id": req.ID, "result": value}) }
		note := func(method string, value any) { _ = enc.Encode(map[string]any{"method": method, "params": value}) }
		switch req.Method {
		case "initialize", "config/read":
			reply(map[string]any{"config": map[string]any{}})
		case "model/list":
			if v := filepath.Base(filepath.Dir(os.Args[0])); v == "10.0.0" || v == "1.0.0" {
				model, name, effort := "fixture-latest", "新版 Codex 验收模型", "ultra"
				if v == "1.0.0" {
					model, name, effort = "fixture-legacy", "旧版 Codex 验收模型", "low"
				}
				reply(map[string]any{"data": []any{map[string]any{"model": model, "displayName": name, "defaultReasoningEffort": effort, "supportedReasoningEfforts": []any{map[string]string{"reasoningEffort": effort}}}}})
				continue
			}
			reply(map[string]any{"data": []any{map[string]any{"model": "fixture-model", "displayName": "本地验收模型", "defaultReasoningEffort": "medium",
				"supportedReasoningEfforts": []any{map[string]string{"reasoningEffort": "medium"}, map[string]string{"reasoningEffort": "high"}}}}})
		case "thread/start":
			reply(map[string]any{"thread": map[string]string{"id": "fixture-thread"}})
		case "turn/start":
			if delay, _ := strconv.Atoi(os.Getenv("RDNEXT_CODEX_DELAY_MS")); delay > 0 {
				time.Sleep(time.Duration(delay) * time.Millisecond)
			}
			var input struct {
				Model  string
				Effort string
				Input  []struct{ Text string }
			}
			_ = json.Unmarshal(req.Params, &input)
			var payload struct {
				Targets []struct {
					ID   string
					Text string
				}
			}
			if len(input.Input) != 1 || json.Unmarshal([]byte(input.Input[0].Text), &payload) != nil {
				return
			}
			if path := os.Getenv("RDNEXT_CODEX_TRACE"); path != "" {
				_ = os.WriteFile(path, req.Params, 0600)
			}
			var alignment struct{ Task, Source, Translation string }
			_ = json.Unmarshal([]byte(input.Input[0].Text), &alignment)
			if alignment.Task == "sentence-alignment" {
				result, _ := json.Marshal(map[string]any{"pairs": []map[string]string{{"source": alignment.Source, "target": alignment.Translation}}})
				reply(map[string]any{"turn": map[string]string{"id": "fixture-turn"}})
				note("item/completed", map[string]any{"threadId": "fixture-thread", "item": map[string]string{"type": "agentMessage", "phase": "final_answer", "text": string(result)}})
				note("turn/completed", map[string]any{"threadId": "fixture-thread", "turn": map[string]string{"status": "completed"}})
				continue
			}
			texts := []map[string]string{}
			failOutput := false
			if path := os.Getenv("RDNEXT_CODEX_FAIL_FILE"); path != "" {
				_, err := os.Stat(path)
				failOutput = err == nil
			}
			for _, target := range payload.Targets {
				if failOutput {
					break
				}
				texts = append(texts, map[string]string{"id": target.ID, "text": "这是一段本地验收译文。 " + strings.Join(token.FindAllString(target.Text, -1), " ")})
			}
			result, _ := json.Marshal(map[string]any{"translations": texts})
			reply(map[string]any{"turn": map[string]string{"id": "fixture-turn"}})
			note("item/completed", map[string]any{"threadId": "fixture-thread", "item": map[string]string{"type": "agentMessage", "phase": "final_answer", "text": string(result)}})
			note("turn/completed", map[string]any{"threadId": "fixture-thread", "turn": map[string]string{"status": "completed"}})
		}
	}
}

package main

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"regexp"
	"strings"
)

func fixtureTranslation(provider, raw string) string {
	start := strings.LastIndex(raw, "\n\n{")
	if start >= 0 {
		raw = raw[start+2:]
	}
	var request struct {
		Targets []struct {
			ID, Text string
		}
	}
	if json.Unmarshal([]byte(raw), &request) != nil {
		panic("fixture received invalid translation payload")
	}
	token := regexp.MustCompile(`\[\[RD_M[0-9]+\]\]`)
	results := make([]map[string]string, 0, len(request.Targets))
	for _, target := range request.Targets {
		results = append(results, map[string]string{
			"id": target.ID, "text": provider + " 验收译文。 " + strings.Join(token.FindAllString(target.Text, -1), " "),
		})
	}
	response, _ := json.Marshal(map[string]any{"translations": results})
	return string(response)
}

func fixtureBuddy() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		_, _ = os.Stdout.WriteString("2.185.0\n")
		return
	}
	if os.Getenv("CODEBUDDY_API_KEY") != "" || os.Getenv("CODEBUDDY_AUTH_TOKEN") != "" || os.Getenv("CODEBUDDY_BASE_URL") != "" || os.Getenv("CODEBUDDY_CONFIG_DIR") == "" {
		panic("fixture Buddy did not isolate account configuration")
	}
	args := strings.Join(os.Args[1:], "\x00")
	if !strings.Contains(args, "--tools\x00\x00--strict-mcp-config") || !strings.Contains(args, "--no-session-persistence") {
		panic("fixture Buddy invoked without translation isolation")
	}
	if strings.Contains(args, "--acp") {
		fixtureBuddyModels()
		return
	}
	model := "fixture-buddy-free"
	var settings struct{ ReasoningEffort string }
	for i, arg := range os.Args[1:] {
		switch arg {
		case "--model":
			model = os.Args[i+2]
		case "--settings":
			if err := json.Unmarshal([]byte(os.Args[i+2]), &settings); err != nil {
				panic(err)
			}
		}
	}
	if model == "fixture-buddy" && settings.ReasoningEffort != "low" {
		panic("fixture expected the selected low reasoning effort")
	}
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		panic(err)
	}
	encoder := json.NewEncoder(os.Stdout)
	_ = encoder.Encode(map[string]string{"type": "system", "subtype": "init", "model": model})
	_ = encoder.Encode(map[string]any{
		"type": "result", "subtype": "success", "result": fixtureTranslation("WorkBuddy", string(raw)),
		"_meta": map[string]any{"codebuddy.ai/turnUsage": map[string]any{
			"version": 1, "scope": "turn", "kind": "snapshot", "total": map[string]any{"credits": 0.01, "creditStatus": "known"},
		}},
	})
}

func fixtureBuddyModels() {
	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var call struct {
			ID     int
			Method string
		}
		if err := json.Unmarshal(scanner.Bytes(), &call); err != nil {
			panic(err)
		}
		var result any
		switch call.Method {
		case "initialize":
			result = map[string]int{"protocolVersion": 1}
		case "session/new":
			result = map[string]any{"sessionId": "fixture-buddy-models", "models": map[string]any{
				"availableModels": []map[string]any{
					{"modelId": "fixture-buddy", "name": "Buddy Flash", "_meta": map[string]any{
						"effortOptions": []map[string]string{{"value": "low"}, {"value": "high"}, {"value": "max"}, {"value": "high"}, {"value": "unknown"}},
					}},
					{"modelId": "fixture-buddy-free", "name": "Buddy Flash", "_meta": map[string]any{
						"effortOptions": []map[string]string{{"value": "high"}},
					}},
					{"modelId": "fixture-buddy", "name": "Duplicate ID"},
				},
			}}
		default:
			panic("model discovery performed an unexpected operation")
		}
		_ = encoder.Encode(map[string]any{"id": call.ID, "result": result})
	}
}

func fixtureHarness() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	encoder := json.NewEncoder(os.Stdout)
	options := []any{
		map[string]any{"id": "model", "currentValue": "fixture-harness", "options": []map[string]string{
			{"value": "fixture-harness", "name": "Harness 验收模型"},
		}},
		map[string]any{"id": "reasoning_effort", "currentValue": "high", "options": []map[string]string{
			{"value": "low", "name": "低"}, {"value": "high", "name": "高"},
		}},
	}
	for scanner.Scan() {
		if path := os.Getenv("RDNEXT_HARNESS_EVENTS"); path != "" {
			file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
			if err == nil {
				var event map[string]any
				_ = json.Unmarshal(scanner.Bytes(), &event)
				event["pid"] = os.Getpid()
				_ = json.NewEncoder(file).Encode(event)
				_ = file.Close()
			}
		}
		var request struct {
			ID     int
			Method string
			Params struct {
				ConfigID, Value string
				Prompt          []struct{ Text string }
			}
		}
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			return
		}
		result := map[string]any{}
		switch request.Method {
		case "initialize":
			result["protocolVersion"] = 1
		case "session/new":
			if err := os.WriteFile("tool-proof.json", []byte(`{"tools":0}`), 0600); err != nil {
				panic(err)
			}
			result["sessionId"] = "fixture-harness-session"
			result["configOptions"] = options
		case "session/set_config_option":
			if !(request.Params.ConfigID == "model" && request.Params.Value == "fixture-harness" ||
				request.Params.ConfigID == "reasoning_effort" && request.Params.Value == "high") {
				panic("unexpected ACP config choice")
			}
			result["configOptions"] = options
		case "session/prompt":
			response := fixtureTranslation("Harness", request.Params.Prompt[0].Text)
			_ = encoder.Encode(map[string]any{"method": "session/update", "params": map[string]any{
				"sessionId": "fixture-harness-session", "update": map[string]any{
					"sessionUpdate": "agent_message_chunk",
					"content":       map[string]string{"type": "text", "text": response},
				},
			}})
			result["stopReason"] = "end_turn"
		default:
			panic("unexpected ACP method")
		}
		_ = encoder.Encode(map[string]any{"id": request.ID, "result": result})
	}
}

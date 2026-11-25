package workspace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

func buddyRoot() (string, error) {
	if root := os.Getenv("RDNEXT_BUDDY_ROOT"); filepath.IsAbs(root) {
		return filepath.Clean(root), nil
	}
	if local := os.Getenv("LOCALAPPDATA"); filepath.IsAbs(local) {
		return filepath.Join(local, "ResearchDesk Next"), nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", errors.New("无法确定 CodeBuddy 的本机登录目录")
	}
	return filepath.Join(base, "ResearchDesk Next"), nil
}

func buddyLauncher(root string) (translationLauncher, error) {
	env := []string{
		"CODEBUDDY_CONFIG_DIR=" + filepath.Join(root, "buddy-account"),
		"CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS=1", "CODEBUDDY_DISABLE_AUTO_MEMORY=1", "DISABLE_AUTOUPDATER=1",
		"CODEBUDDY_API_KEY=", "CODEBUDDY_AUTH_TOKEN=", "CODEBUDDY_BASE_URL=", "CODEBUDDY_CUSTOM_HEADERS=",
		"CODEBUDDY_MODEL=", "CODEBUDDY_INTERNET_ENVIRONMENT=", "CODEBUDDY_IS_SANDBOX=", "ELECTRON_RUN_AS_NODE=",
	}
	if path := os.Getenv("RDNEXT_CODEBUDDY"); filepath.IsAbs(path) && fileExists(path) &&
		(filepath.Separator != '\\' || strings.EqualFold(filepath.Ext(path), ".exe")) {
		return translationLauncher{path: path, env: env}, nil
	}

	bin, node := "codebuddy", "node"
	if filepath.Separator == '\\' {
		bin, node = "codebuddy.exe", "node.exe"
	}
	if path, err := exec.LookPath(bin); err == nil && filepath.IsAbs(path) {
		return translationLauncher{path: path, env: env}, nil
	}
	if home, err := os.UserHomeDir(); err == nil {
		if path := filepath.Join(home, ".local", "bin", bin); fileExists(path) {
			return translationLauncher{path: path, env: env}, nil
		}
	}

	npmPrefixes := []string{filepath.Join(root, "codebuddy-cli")}
	if appdata := os.Getenv("APPDATA"); filepath.IsAbs(appdata) {
		npmPrefixes = append(npmPrefixes, filepath.Join(appdata, "npm"))
	}
	if filepath.Separator == '\\' {
		if shim, err := exec.LookPath("codebuddy.cmd"); err == nil && filepath.IsAbs(shim) {
			npmPrefixes = append(npmPrefixes, filepath.Dir(shim))
		}
	}
	for _, prefix := range npmPrefixes {
		entry := filepath.Join(prefix, "node_modules", "@tencent-ai", "codebuddy-code", "bin", "codebuddy")
		if !fileExists(entry) {
			continue
		}
		nodePath, err := exec.LookPath(node)
		if err != nil || !filepath.IsAbs(nodePath) {
			return translationLauncher{}, errors.New("已安装 CodeBuddy CLI，请安装 Node.js 或使用腾讯官方的独立 Windows 安装版")
		}
		return translationLauncher{path: nodePath, args: []string{entry}, env: env}, nil
	}
	return translationLauncher{}, errors.New("未找到腾讯官方独立 CodeBuddy CLI，请先安装")
}

func (w *Workspace) buddyLoginCommand(rw http.ResponseWriter, r *http.Request) {
	root, err := buddyRoot()
	if err != nil {
		fail(rw, 503, err.Error())
		return
	}
	launcher, err := buddyLauncher(root)
	if err != nil {
		fail(rw, 404, err.Error())
		return
	}
	cwd := filepath.Join(root, "buddy-login")
	for _, dir := range []string{cwd, filepath.Join(root, "buddy-account")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			fail(rw, 500, "无法创建 CodeBuddy 登录目录")
			return
		}
	}
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
	lines := []string{"Set-Location -LiteralPath " + quote(cwd), "$env:NODE_OPTIONS=''", "$env:NODE_PATH=''"}
	for _, v := range launcher.env {
		name, value, _ := strings.Cut(v, "=")
		lines = append(lines, "$env:"+name+"="+quote(value))
	}
	args := append(append([]string{launcher.path}, launcher.args...), "--agent", "cli")
	for i := range args {
		args[i] = quote(args[i])
	}
	lines = append(lines, "& "+strings.Join(args, " "))
	respond(rw, 200, map[string]string{"command": strings.Join(lines, "\r\n"), "directory": cwd})
}

var buddyEffortLevels = []string{"minimal", "low", "medium", "high", "xhigh", "max"}

func buddyModels(ctx context.Context) ([]CodexModel, error) {
	root, err := buddyRoot()
	if err != nil {
		return nil, err
	}
	launcher, err := buddyLauncher(root)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	dir, err := os.MkdirTemp("", "rdnext-buddy-models-")
	if err != nil {
		return nil, errors.New("无法初始化 CodeBuddy 模型读取环境")
	}
	defer os.RemoveAll(dir)
	mcp := filepath.Join(dir, "empty-mcp.json")
	if err := os.WriteFile(mcp, []byte(`{"mcpServers":{}}`), 0600); err != nil {
		return nil, errors.New("无法写入 CodeBuddy 模型读取配置")
	}
	cmd := launcher.command(ctx, dir, "--acp", "--agent", "cli", "--tools", "", "--strict-mcp-config",
		"--mcp-config", mcp, "--setting-sources", "project,local", "--no-session-persistence")
	peer, err := openTranslationACP(ctx, cmd, dir, "CodeBuddy")
	if err != nil {
		return nil, err
	}
	defer peer.close()
	if err := peer.initialize(); err != nil {
		return nil, err
	}
	var session struct {
		harnessConfig
		Models struct {
			Available []struct {
				ID       string `json:"modelId"`
				Name     string `json:"name"`
				Metadata struct {
					EffortOptions []struct {
						Value string `json:"value"`
					} `json:"effortOptions"`
				} `json:"_meta"`
			} `json:"availableModels"`
		} `json:"models"`
	}
	if err := peer.call("session/new", map[string]any{"cwd": dir, "mcpServers": []any{}}, &session, nil); err != nil {
		return nil, err
	}
	rows := []CodexModel{{ID: "@default", Name: "账号默认模型", Efforts: []string{}}}
	seen := map[string]bool{"@default": true}
	names := map[string]int{rows[0].Name: 1}
	add := func(id, name string, efforts []string) {
		id, name = strings.TrimSpace(id), strings.TrimSpace(name)
		if seen[id] || id == "" || len(id) > 200 || strings.ContainsAny(id, "\r\n\x00") {
			return
		}
		if name == "" {
			name = id
		}
		rows = append(rows, CodexModel{ID: id, Name: name, Efforts: efforts})
		seen[id] = true
		names[name]++
	}
	for _, item := range session.Models.Available {
		efforts := []string{}
		for _, option := range item.Metadata.EffortOptions {
			if slices.Contains(buddyEffortLevels, option.Value) && !slices.Contains(efforts, option.Value) {
				efforts = append(efforts, option.Value)
			}
		}
		add(item.ID, item.Name, efforts)
	}
	if len(rows) == 1 {
		for _, item := range harnessChoices(session.option("model").Options) {
			add(item.Value, item.Name, []string{})
		}
	}
	if session.Session == "" || len(rows) == 1 {
		return nil, errors.New("CodeBuddy 未提供模型列表，请检查登录状态或更新独立 CLI 后重新读取")
	}
	for i := 1; i < len(rows); i++ {
		if names[rows[i].Name] > 1 {
			rows[i].Name += " · " + rows[i].ID
		}
	}
	return rows, nil
}

func validateBuddyEffort(ctx context.Context, model, effort string) error {
	if effort == "" {
		return nil
	}
	models, err := buddyModels(ctx)
	if err != nil {
		return err
	}
	for _, item := range models {
		if item.ID == model && slices.Contains(item.Efforts, effort) {
			return nil
		}
	}
	return errors.New("该模型的可用思考强度已变化，请刷新模型列表并重新选择")
}

type buddyTrial struct {
	text    string
	Model   string   `json:"model,omitempty"`
	Credits *float64 `json:"credits,omitempty"`
}

func buddyTranslate(ctx context.Context, model, effort, prompt string) (buddyTrial, error) {
	root, err := buddyRoot()
	if err != nil {
		return buddyTrial{}, err
	}
	launcher, err := buddyLauncher(root)
	if err != nil {
		return buddyTrial{}, err
	}
	dir, err := os.MkdirTemp("", "rdnext-buddy-")
	if err != nil {
		return buddyTrial{}, errors.New("无法创建 CodeBuddy 翻译环境")
	}
	defer os.RemoveAll(dir)
	mcp := filepath.Join(dir, "empty-mcp.json")
	if err := os.WriteFile(mcp, []byte(`{"mcpServers":{}}`), 0600); err != nil {
		return buddyTrial{}, errors.New("无法写入翻译隔离配置")
	}
	args := []string{"-p", "--output-format", "stream-json", "--verbose", "--agent", "cli", "--tools", "",
		"--strict-mcp-config", "--mcp-config", mcp, "--setting-sources", "project,local", "--max-turns", "1",
		"--no-session-persistence", "--system-prompt", translationInstructions()}
	if model != "@default" {
		args = append(args, "--model", model)
	}
	if effort != "" {
		settings, _ := json.Marshal(map[string]string{"reasoningEffort": effort})
		args = append(args, "--settings", string(settings))
	}
	cmd := launcher.command(ctx, dir, args...)
	cmd.Stdin = strings.NewReader(prompt)
	out := translationOutput{max: maxTranslationResponse}
	diagnostic := translationOutput{max: 64 << 10}
	cmd.Stdout, cmd.Stderr = &out, &diagnostic
	stop, err := startOwnedTranslationProcess(cmd)
	if err != nil {
		return buddyTrial{}, errors.New("无法启动 CodeBuddy CLI")
	}
	err = cmd.Wait()
	stop()
	if ctx.Err() != nil {
		return buddyTrial{}, ctx.Err()
	}
	if err == nil {
		if trial, ok := readBuddyTrial(out.Bytes()); ok {
			return trial, nil
		}
	}
	return buddyTrial{}, runtimeTranslationError("腾讯 Buddy", out.String()+"\n"+diagnostic.String(),
		"未返回完整译文，请检查本机 CLI 版本或模型状态")
}

func readBuddyTrial(raw []byte) (buddyTrial, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	result := buddyTrial{}
	complete := false
	for {
		var event struct {
			Type, Subtype, Model, Result string
			Error                        bool   `json:"is_error"`
			Terminal                     string `json:"terminal_reason"`
			Metadata                     struct {
				Turn struct {
					Version     int
					Scope, Kind string
					Total       struct {
						Credits      *float64
						CreditStatus string
					}
				} `json:"codebuddy.ai/turnUsage"`
			} `json:"_meta"`
		}
		err := decoder.Decode(&event)
		if errors.Is(err, io.EOF) {
			return result, complete
		}
		if err != nil || complete {
			return buddyTrial{}, false
		}
		if event.Type == "system" && event.Subtype == "init" {
			result.Model = event.Model
		}
		if event.Type != "result" {
			continue
		}
		if event.Subtype != "success" || event.Error || strings.TrimSpace(event.Result) == "" ||
			strings.Contains(strings.ToLower(event.Terminal), "cancel") || strings.Contains(strings.ToLower(event.Terminal), "interrupt") {
			return buddyTrial{}, false
		}
		result.text = cleanTranslationJSON(event.Result)
		turn := event.Metadata.Turn
		if turn.Version == 1 && turn.Scope == "turn" && turn.Kind == "snapshot" &&
			turn.Total.CreditStatus == "known" && turn.Total.Credits != nil && *turn.Total.Credits >= 0 {
			result.Credits = turn.Total.Credits
		}
		complete = true
	}
}

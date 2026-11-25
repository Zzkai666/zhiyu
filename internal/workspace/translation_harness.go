package workspace

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type translationACP struct {
	ctx            context.Context
	cmd            *exec.Cmd
	input          io.WriteCloser
	output         *bufio.Scanner
	closeProcesses func()
	work, session  string
	provider       string
	nextID         int
}

type harnessOption struct {
	ID      string          `json:"id"`
	Value   string          `json:"value"`
	Current string          `json:"currentValue"`
	Name    string          `json:"name"`
	Options []harnessOption `json:"options"`
}
type harnessConfig struct {
	Session string          `json:"sessionId"`
	Options []harnessOption `json:"configOptions"`
}

func (cfg harnessConfig) option(id string) harnessOption {
	for _, option := range cfg.Options {
		if option.ID == id {
			return option
		}
	}
	return harnessOption{}
}
func harnessChoices(options []harnessOption) []harnessOption {
	var flat []harnessOption
	for _, option := range options {
		if len(option.Options) > 0 {
			for _, child := range option.Options {
				if child.Value == "" {
					continue
				}
				if child.Name == "" {
					child.Name = child.Value
				}
				if option.Name != "" {
					child.Name = option.Name + " · " + child.Name
				}
				flat = append(flat, child)
			}
		} else if option.Value != "" {
			if option.Name == "" {
				option.Name = option.Value
			}
			flat = append(flat, option)
		}
	}
	return flat
}

func openHarness(ctx context.Context) (*translationACP, harnessConfig, error) {
	launcher, err := harnessLauncher()
	if err != nil {
		return nil, harnessConfig{}, err
	}
	work, err := os.MkdirTemp("", "rdnext-harness-")
	if err != nil {
		return nil, harnessConfig{}, errors.New("无法创建 Harness 翻译环境")
	}
	done := false
	defer func() {
		if !done {
			_ = os.RemoveAll(work)
		}
	}()
	proof := filepath.Join(work, "tool-proof.json")
	proofPath, _ := json.Marshal(proof)
	guard := filepath.Join(work, "text-only.mjs")
	script := "import fs from 'node:fs';\nexport const name='rdnext-translation-policy';\nexport const inject=['tools'];\nexport function apply(ctx){ctx.tools.guard(()=> 'Translation has no tools');ctx.on('agent/created',({agent})=>{agent.ctx.tools.restrict({allow:[]});const count=ctx.tools.schemas(agent).length;if(count!==0)throw Error('Tools are enabled');fs.writeFileSync(" + string(proofPath) + ",JSON.stringify({tools:count}));});}\n"
	if err := os.WriteFile(guard, []byte(script), 0600); err != nil {
		return nil, harnessConfig{}, errors.New("无法初始化 Harness 工具隔离")
	}
	patch := []map[string]any{}
	for _, id := range []string{"hmr", "session-title-llm", "config-editor", "agent-instructions", "skill-filesystem", "tool-skill", "tool-fs", "tool-fs-search", "tool-working-directory", "tool-bash", "tool-pwsh", "tool-jobs", "tool-web", "tool-subagent", "tool-subagent-fork", "tool-subagent-control", "tool-subagent-list-agents", "tool-workflow", "tool-goal", "tool-todo", "tool-plugin-manager", "session-log-deepseek"} {
		patch = append(patch, map[string]any{"id": id, "disabled": true})
	}
	patch = append(patch,
		map[string]any{"id": "session-persistence-jsonl", "config": map[string]string{"root": filepath.Join(work, "sessions")}},
		map[string]any{"id": "system-prompt", "config": map[string]string{"personaPrefix": "You are a scientific translator. Process only the supplied text. No tools or external actions."}},
		map[string]any{"insert": []map[string]any{{"id": "rdnext-translation-policy", "name": fileURL(guard), "config": map[string]any{}}}},
	)
	raw, _ := json.Marshal(patch)
	overlay := filepath.Join(work, "translation-overlay.json")
	if err := os.WriteFile(overlay, raw, 0600); err != nil {
		return nil, harnessConfig{}, errors.New("无法初始化 Harness 翻译配置")
	}
	launcher.env = append(launcher.env, "DSH_TELEMETRY_DISABLED=1", "DSH_PERMISSION_MODE=read-only")
	cmd := launcher.command(ctx, work, "--profile", "acp", "--patch", overlay)
	peer, err := openTranslationACP(ctx, cmd, work, "DeepSeek Harness")
	if err != nil {
		return nil, harnessConfig{}, err
	}
	defer func() {
		if !done {
			peer.close()
		}
	}()
	if err = peer.initialize(); err != nil {
		return nil, harnessConfig{}, err
	}
	var cfg harnessConfig
	if err = peer.call("session/new", map[string]any{"cwd": work, "mcpServers": []any{}}, &cfg, nil); err != nil {
		return nil, harnessConfig{}, err
	}
	peer.session = cfg.Session
	if peer.session == "" {
		return nil, harnessConfig{}, errors.New("Harness 没有建立翻译会话")
	}
	evidence, err := os.ReadFile(proof)
	if err != nil || string(evidence) != `{"tools":0}` {
		return nil, harnessConfig{}, errors.New("Harness 的无工具翻译环境未通过验证")
	}
	done = true
	return peer, cfg, nil
}

func openTranslationACP(ctx context.Context, cmd *exec.Cmd, work, provider string) (*translationACP, error) {
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		in.Close()
		return nil, err
	}
	stop, err := startOwnedTranslationProcess(cmd)
	if err != nil {
		in.Close()
		out.Close()
		return nil, errors.New("无法启动 " + provider)
	}
	peer := &translationACP{ctx: ctx, cmd: cmd, input: in, output: bufio.NewScanner(out), closeProcesses: stop, work: work, provider: provider}
	peer.output.Buffer(make([]byte, 64<<10), maxTranslationResponse)
	return peer, nil
}

func (p *translationACP) initialize() error {
	var result struct {
		Version int `json:"protocolVersion"`
	}
	params := map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{},
		"clientInfo": map[string]string{"name": "ResearchDesk Next", "version": "0.9.6"}}
	if err := p.call("initialize", params, &result, nil); err != nil {
		return err
	}
	if result.Version != 1 {
		return errors.New("当前 " + p.provider + " ACP 版本不受支持")
	}
	return nil
}

func (p *translationACP) close() {
	_ = p.input.Close()
	p.closeProcesses()
	_ = p.cmd.Process.Kill()
	_ = p.cmd.Wait()
	_ = os.RemoveAll(p.work)
}

func (p *translationACP) send(message map[string]any) error {
	message["jsonrpc"] = "2.0"
	if err := json.NewEncoder(p.input).Encode(message); err != nil {
		return errors.New(p.provider + " 连接中断")
	}
	return nil
}
func (p *translationACP) call(method string, params any, result any, output *strings.Builder) error {
	p.nextID++
	id := p.nextID
	if err := p.send(map[string]any{"id": id, "method": method, "params": params}); err != nil {
		return err
	}
	for p.output.Scan() {
		var event codexMessage
		if json.Unmarshal(p.output.Bytes(), &event) != nil {
			return errors.New(p.provider + " 返回的 ACP 消息无效")
		}
		if event.Method != "" && len(event.ID) > 0 && string(event.ID) != "null" {
			reply := map[string]any{"id": event.ID, "error": map[string]any{"code": -32601, "message": "Translation exposes no client tools"}}
			if event.Method == "session/request_permission" {
				delete(reply, "error")
				reply["result"] = map[string]any{"outcome": map[string]string{"outcome": "cancelled"}}
			}
			if err := p.send(reply); err != nil {
				return err
			}
			continue
		}
		if event.Method == "session/update" && output != nil {
			var update struct {
				Session string `json:"sessionId"`
				Update  struct {
					Kind    string `json:"sessionUpdate"`
					Content struct {
						Type string `json:"type"`
						Text string `json:"text"`
					} `json:"content"`
				} `json:"update"`
			}
			if json.Unmarshal(event.Params, &update) == nil && update.Session == p.session && update.Update.Kind == "agent_message_chunk" && update.Update.Content.Type == "text" {
				if output.Len()+len(update.Update.Content.Text) > maxTranslationResponse {
					return errors.New("Harness 译文过长")
				}
				output.WriteString(update.Update.Content.Text)
			}
		}
		var responseID int
		if json.Unmarshal(event.ID, &responseID) == nil && responseID == id {
			if len(event.Error) > 0 && string(event.Error) != "null" {
				return runtimeTranslationError(p.provider, string(event.Error), "请求未完成（"+method+"），请检查本机登录、模型和额度")
			}
			if json.Unmarshal(event.Result, result) != nil {
				return errors.New(p.provider + " 返回的 ACP 响应无效")
			}
			return nil
		}
	}
	if p.ctx.Err() != nil {
		return p.ctx.Err()
	}
	return errors.New(p.provider + " 连接中断，请检查安装版本")
}

func (p *translationACP) selectOption(id, value string) (harnessConfig, error) {
	var cfg harnessConfig
	err := p.call("session/set_config_option", map[string]string{"sessionId": p.session, "configId": id, "value": value}, &cfg, nil)
	return cfg, err
}

func harnessModels(ctx context.Context, selected string) ([]CodexModel, error) {
	p, cfg, err := openHarness(ctx)
	if err != nil {
		return nil, err
	}
	defer p.close()
	model := cfg.option("model")
	useCurrent := selected == ""
	if selected == "" {
		selected = model.Current
	}
	out := []CodexModel{}
	for _, option := range harnessChoices(model.Options) {
		item := CodexModel{ID: option.Value, Name: option.Name, Efforts: []string{}}
		if option.Value == selected {
			choice := cfg
			if model.Current != selected {
				choice, err = p.selectOption("model", selected)
				if err != nil {
					return nil, err
				}
			}
			effort := choice.option("reasoning_effort")
			item.DefaultEffort = effort.Current
			for _, choice := range harnessChoices(effort.Options) {
				item.Efforts = append(item.Efforts, choice.Value)
			}
		}
		if useCurrent && option.Value == selected {
			out = append([]CodexModel{item}, out...)
		} else {
			out = append(out, item)
		}
	}
	return out, nil
}

func openHarnessTranslation(ctx context.Context, model, effort string) (*translationACP, error) {
	peer, _, err := openHarness(ctx)
	if err != nil {
		return nil, err
	}
	if err := configureHarnessTranslation(peer, model, effort); err != nil {
		peer.close()
		return nil, err
	}
	return peer, nil
}

func configureHarnessTranslation(peer *translationACP, model, effort string) error {
	cfg, err := peer.selectOption("model", model)
	if err != nil || effort == "" {
		return err
	}
	for _, option := range harnessChoices(cfg.option("reasoning_effort").Options) {
		if option.Value == effort {
			_, err = peer.selectOption("reasoning_effort", effort)
			return err
		}
	}
	return errors.New("当前 Harness 模型不支持所选的思考强度")
}

func (p *translationACP) translate(batch preparedTranslation, continued bool) (string, error) {
	var result struct {
		StopReason string `json:"stopReason"`
	}
	var output strings.Builder
	prompt := batch.prompt(continued)
	if !continued {
		prompt = translationInstructions() + "\n\n" + prompt
	}
	blocks := []map[string]string{{"type": "text", "text": prompt}}
	if err := p.call("session/prompt", map[string]any{"sessionId": p.session, "prompt": blocks}, &result, &output); err != nil {
		return "", err
	}
	if result.StopReason == "max_tokens" {
		return "", &translationResponseError{"Harness 译文达到了输出长度限制"}
	}
	if result.StopReason != "end_turn" || strings.TrimSpace(output.String()) == "" {
		return "", errors.New("Harness 未返回完整译文，请检查账号额度或模型状态")
	}
	return cleanTranslationJSON(output.String()), nil
}

func fileURL(path string) string {
	path = filepath.ToSlash(path)
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return (&url.URL{Scheme: "file", Path: path}).String()
}

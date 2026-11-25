package workspace

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const translationShape = `{"type":"object","properties":{"translations":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"text":{"type":"string"}},"required":["id","text"],"additionalProperties":false}}},"required":["translations"],"additionalProperties":false}`
const maxTranslationResponse = 4 << 20

type translationRun func(context.Context, preparedTranslation) (string, error)

type translationConnection struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	BaseURL  string `json:"baseURL,omitempty"`
	Revision int    `json:"revision"`
	HasKey   bool   `json:"hasKey,omitempty"`
}

type apiTranslationConnection struct {
	translationConnection
	key []byte
}

func validTranslationConnection(id string) bool {
	return id == "" || id == "codex" || id == "harness" || id == "buddy" || strings.HasPrefix(id, "api-") && validID(strings.TrimPrefix(id, "api-"), 32)
}

func (w *Workspace) translationConnections(rw http.ResponseWriter, r *http.Request) {
	options := []translationConnection{
		{ID: "codex", Name: "Codex", Kind: "codex"},
		{ID: "harness", Name: "DeepSeek Harness", Kind: "harness"},
		{ID: "buddy", Name: "腾讯 Buddy（账号积分）", Kind: "buddy"},
	}
	rows, err := w.db.QueryContext(r.Context(), "SELECT id,name,base_url,revision,length(secret)>0 FROM translation_connections ORDER BY name,id")
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		v := translationConnection{Kind: "api"}
		if err = rows.Scan(&v.ID, &v.Name, &v.BaseURL, &v.Revision, &v.HasKey); err != nil {
			databaseError(rw, err)
			return
		}
		options = append(options, v)
	}
	if err = rows.Err(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, options)
}

func translationAPIBase(value string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return "", errors.New("请提供不含账号、查询参数或片段的 API 基础地址")
	}
	hostIP := net.ParseIP(u.Hostname())
	local := strings.EqualFold(u.Hostname(), "localhost") || hostIP != nil && hostIP.IsLoopback()
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return "", errors.New("远程 API 地址请使用 HTTPS，本机回环地址可使用 HTTP")
	}
	return strings.TrimRight(u.String(), "/"), nil
}

func (w *Workspace) saveTranslationConnection(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		BaseURL  string `json:"baseURL"`
		Key      string `json:"key"`
		Revision int    `json:"revision"`
		ClearKey bool   `json:"clearKey"`
	}
	if !readJSON(rw, r, 16<<10, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Key = strings.TrimSpace(input.Key)
	base, err := translationAPIBase(input.BaseURL)
	if err != nil {
		fail(rw, 400, err.Error())
		return
	}
	if input.Name == "" || len(input.Name) > 200 || len(base) > 1500 || len(input.Key) > 4096 ||
		strings.ContainsAny(input.Key, "\r\n") || input.ClearKey && input.Key != "" ||
		input.ID != "" && (!strings.HasPrefix(input.ID, "api-") || !validTranslationConnection(input.ID)) {
		fail(rw, 400, "API 连接配置无效")
		return
	}
	var secret []byte
	if input.Key != "" {
		secret, err = protectTranslationKey([]byte(input.Key))
		if err != nil {
			fail(rw, 500, "无法使用系统凭据保护保存 API 密钥")
			return
		}
	}
	ctx := r.Context()
	v := translationConnection{ID: input.ID, Name: input.Name, Kind: "api", BaseURL: base}
	if v.ID == "" {
		v.ID, v.Revision = "api-"+newID(), 1
		_, err = w.db.ExecContext(ctx, "INSERT INTO translation_connections(id,name,base_url,secret,revision) VALUES(?,?,?,coalesce(?,X''),1)",
			v.ID, v.Name, base, secret)
		v.HasKey = len(secret) != 0
	} else {
		err = w.db.QueryRowContext(ctx, `UPDATE translation_connections SET name=?,base_url=?,
		secret=CASE WHEN ? THEN X'' ELSE coalesce(?,secret) END,revision=revision+1
		WHERE id=? AND revision=? AND (base_url=? OR length(secret)=0 OR ? OR ? IS NOT NULL)
		RETURNING revision,length(secret)>0`, v.Name, base, input.ClearKey, secret, v.ID, input.Revision, base, input.ClearKey, secret).
			Scan(&v.Revision, &v.HasKey)
	}
	if errors.Is(err, sql.ErrNoRows) {
		fail(rw, 409, "连接已变化，或地址已修改，请重新打开设置并重新填写或清除密钥")
		return
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, v)
}

func (w *Workspace) resolveTranslationAPI(ctx context.Context, id string, revision int) (apiTranslationConnection, error) {
	v := apiTranslationConnection{translationConnection: translationConnection{ID: id, Kind: "api"}}
	var secret []byte
	err := w.db.QueryRowContext(ctx, "SELECT name,base_url,secret,revision FROM translation_connections WHERE id=?", id).
		Scan(&v.Name, &v.BaseURL, &secret, &v.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return v, errors.New("找不到此 API 连接，请重新选择")
	}
	if err != nil {
		return v, err
	}
	if revision != v.Revision {
		return v, errors.New("API 连接配置已更新，请重新选择后再开始翻译")
	}
	if len(secret) != 0 {
		v.key, err = unprotectTranslationKey(secret)
		if err != nil {
			return v, errors.New("无法读取本机保存的 API 密钥，请重新填写")
		}
	}
	return v, nil
}

var translationHTTP = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func (v apiTranslationConnection) request(ctx context.Context, method, path string, input any, output any) error {
	var data []byte
	if input != nil {
		var err error
		data, err = json.Marshal(input)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, v.BaseURL+path, bytes.NewReader(data))
	if err != nil {
		return errors.New("API 请求地址无效")
	}
	req.Header.Set("Accept", "application/json")
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if len(v.key) > 0 {
		req.Header.Set("Authorization", "Bearer "+string(v.key))
	}
	res, err := translationHTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("API 连接失败，请检查网络与地址")
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case 200:
	case 401, 403:
		return errors.New("API 拒绝访问，请检查密钥和模型权限")
	case 402:
		return errors.New("API 余额不足")
	case 429:
		return errors.New("API 限流或额度不足，请稍后重试")
	default:
		return fmt.Errorf("API 请求失败（HTTP %d），请核对地址、模型及参数", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxTranslationResponse+1))
	if err != nil || len(body) > maxTranslationResponse || json.Unmarshal(body, output) != nil {
		return errors.New("API 返回的响应不是可用的 JSON 数据")
	}
	return nil
}

func (v apiTranslationConnection) models(ctx context.Context) ([]CodexModel, error) {
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := v.request(ctx, http.MethodGet, "/models", nil, &out); err != nil {
		return nil, err
	}
	models := []CodexModel{}
	seen := map[string]bool{}
	for _, row := range out.Data {
		if row.ID != "" && len(row.ID) <= 250 && !seen[row.ID] {
			models = append(models, CodexModel{ID: row.ID, Name: row.ID, Efforts: []string{}})
			seen[row.ID] = true
		}
	}
	return models, nil
}

func (v apiTranslationConnection) translate(ctx context.Context, model, effort, prompt string) (string, error) {
	var out struct {
		Choices []struct {
			Finish  string `json:"finish_reason"`
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	request := map[string]any{
		"model": model, "stream": false,
		"messages": []map[string]string{{"role": "system", "content": translationInstructions()}, {"role": "user", "content": prompt}},
	}
	if effort != "" {
		request["reasoning_effort"] = effort
	}
	if err := v.request(ctx, http.MethodPost, "/chat/completions", request, &out); err != nil {
		return "", err
	}
	if len(out.Choices) > 0 && out.Choices[0].Finish == "length" {
		return "", &translationResponseError{"API 译文达到了输出长度限制"}
	}
	if len(out.Choices) == 0 || out.Choices[0].Finish != "stop" || strings.TrimSpace(out.Choices[0].Message.Content) == "" {
		return "", errors.New("API 未返回完整译文，可能已达到输出长度限制")
	}
	return cleanTranslationJSON(out.Choices[0].Message.Content), nil
}

func translationInstructions() string {
	return translatorPrompt + "\nReturn only one JSON object matching this schema, with no added prose: " + translationShape
}

func cleanTranslationJSON(value string) string {
	value = strings.TrimSpace(value)
	if body, ok := strings.CutPrefix(value, "```json"); ok {
		if body, ok = strings.CutSuffix(body, "```"); ok {
			return strings.TrimSpace(body)
		}
	}
	return value
}

// Keep history short and scoped to one paper job. Only native sessions carry turns.
const translationSessionTurns = 3

func (w *Workspace) openTranslation(ctx context.Context, input translateInput) (translationRun, func(), error) {
	noop := func() {}
	switch input.Connection {
	case "", "codex":
		c, err := w.openCodex(ctx)
		if err != nil {
			return nil, noop, err
		}
		thread := ""
		turns := 0
		return func(deadline context.Context, batch preparedTranslation) (string, error) {
			kill := context.AfterFunc(deadline, func() { _ = c.cmd.Process.Kill() })
			defer kill()
			if thread == "" || turns == translationSessionTurns || batch.freshSession {
				thread, err = c.startTranslationThread(input.Model)
				turns = 0
				if err != nil {
					return "", err
				}
			}
			text, err := c.translate(thread, input.Model, input.Effort, batch.prompt(turns > 0))
			turns++
			return text, err
		}, c.close, nil
	case "harness":
		var peer *translationACP
		var cancelPeer context.CancelFunc
		turns := 0
		closePeer := func() {
			if peer != nil {
				cancelPeer()
				peer.close()
				peer = nil
			}
		}
		return func(deadline context.Context, batch preparedTranslation) (string, error) {
			if peer == nil || turns == translationSessionTurns || batch.freshSession {
				closePeer()
				// Allow setup to time out without binding the lifetime of a reused process to one turn.
				window, cancel := context.WithCancel(ctx)
				stopSetup := context.AfterFunc(deadline, cancel)
				next, err := openHarnessTranslation(window, input.Model, input.Effort)
				stopSetup()
				if err != nil {
					cancel()
					return "", err
				}
				peer = next
				cancelPeer = cancel
				turns = 0
			}
			process := peer.cmd.Process
			kill := context.AfterFunc(deadline, func() { _ = process.Kill() })
			defer kill()
			text, err := peer.translate(batch, turns > 0)
			turns++
			return text, err
		}, closePeer, nil
	case "buddy":
		if err := validateBuddyEffort(ctx, input.Model, input.Effort); err != nil {
			return nil, noop, err
		}
		return func(deadline context.Context, batch preparedTranslation) (string, error) {
			result, err := buddyTranslate(deadline, input.Model, input.Effort, batch.prompt(false))
			return result.text, err
		}, noop, nil
	default:
		cfg, err := w.resolveTranslationAPI(ctx, input.Connection, input.ConnectionRevision)
		if err != nil {
			return nil, noop, err
		}
		return func(deadline context.Context, batch preparedTranslation) (string, error) {
			return cfg.translate(deadline, input.Model, input.Effort, batch.prompt(false))
		}, noop, nil
	}
}

func (w *Workspace) listTranslationModels(rw http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("connection")
	if id == "" || id == "codex" {
		w.listCodexModels(rw, r)
		return
	}
	revision, _ := strconv.Atoi(r.URL.Query().Get("revision"))
	if !validTranslationConnection(id) {
		fail(rw, 400, "翻译连接无效")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	var models []CodexModel
	var err error
	switch id {
	case "harness":
		models, err = harnessModels(ctx, r.URL.Query().Get("model"))
	case "buddy":
		models, err = buddyModels(ctx)
	default:
		var cfg apiTranslationConnection
		cfg, err = w.resolveTranslationAPI(ctx, id, revision)
		if err == nil {
			models, err = cfg.models(ctx)
		}
	}
	if err != nil {
		fail(rw, 502, err.Error())
		return
	}
	respond(rw, 200, models)
}

func (w *Workspace) testTranslation(rw http.ResponseWriter, r *http.Request) {
	var input translateInput
	if !readJSON(rw, r, 8192, &input) {
		return
	}
	input.Groups = []string{"sample"}
	if !validTranslationInput(input, 1) {
		fail(rw, 400, "请选择连接和模型")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	actual := TranslationItem{ID: "sample", Text: "The model learns from demonstrations."}
	batch := preparedTranslation{targets: []TranslationItem{actual}}
	batch.payload, _ = json.Marshal(map[string]any{"targets": batch.targets})
	var raw string
	var trial buddyTrial
	var err error
	if input.Connection == "buddy" {
		if err := validateBuddyEffort(ctx, input.Model, input.Effort); err != nil {
			fail(rw, 422, err.Error())
			return
		}
		trial, err = buddyTranslate(ctx, input.Model, input.Effort, batch.prompt(false))
		raw = trial.text
	} else {
		run, closeRun, openErr := w.openTranslation(ctx, input)
		if openErr != nil {
			fail(rw, 503, openErr.Error())
			return
		}
		defer closeRun()
		raw, err = run(ctx, batch)
	}
	if err != nil {
		fail(rw, 502, err.Error())
		return
	}
	value, err := validateTranslation(raw, batch)
	if err != nil {
		fail(rw, 502, err.Error())
		return
	}
	respond(rw, 200, struct {
		Translation string `json:"translation"`
		buddyTrial
	}{value["sample"], trial})
}

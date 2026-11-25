package workspace

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type CodexInstall struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	Source  string `json:"source"`
}
type CodexConnection struct {
	CodexInstall
	Automatic  bool           `json:"automatic"`
	Revision   int            `json:"revision"`
	Candidates []CodexInstall `json:"candidates"`
	Error      string         `json:"error,omitempty"`
}

var versionDigits = regexp.MustCompile("[0-9]+")

func versionNumbers(value string) []int {
	parts := versionDigits.FindAllString(value, -1)
	out := []int{}
	for _, p := range parts {
		n, _ := strconv.Atoi(p)
		out = append(out, n)
	}
	return out
}
func newerVersion(a, b string) bool {
	x, y := versionNumbers(a), versionNumbers(b)
	for i := 0; i < max(len(x), len(y)); i++ {
		l, r := 0, 0
		if i < len(x) {
			l = x[i]
		}
		if i < len(y) {
			r = y[i]
		}
		if l != r {
			return l > r
		}
	}
	return false
}
func probeCodexVersion(path string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, path, "--version")
	hideCodexWindow(c)
	b, e := c.Output()
	if e != nil || len(b) > 300 {
		return ""
	}
	return strings.TrimSpace(string(b))
}
func nativeCodexPaths(path string) []string {
	if runtime.GOOS != "windows" || !strings.EqualFold(filepath.Ext(path), ".cmd") {
		return []string{path}
	}
	root := filepath.Dir(path)
	out := []string{}
	for _, pattern := range []string{filepath.Join(root, "node_modules", "@openai", "codex", "vendor", "*", "codex", "codex.exe"), filepath.Join(root, "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-*", "vendor", "*", "codex", "codex.exe")} {
		matches, _ := filepath.Glob(pattern)
		out = append(out, matches...)
	}
	if len(out) == 0 {
		return []string{path}
	}
	return out
}
func codexInstalls() []CodexInstall {
	list := []CodexInstall{}
	seen := map[string]bool{}
	add := func(path, source string) {
		if !filepath.IsAbs(path) {
			return
		}
		for _, p := range nativeCodexPaths(path) {
			p = filepath.Clean(p)
			info, e := os.Stat(p)
			k := strings.ToLower(p)
			if e == nil && !info.IsDir() && !seen[k] {
				seen[k] = true
				list = append(list, CodexInstall{Path: p, Source: source})
			}
		}
	}
	if path, e := exec.LookPath("codex"); e == nil {
		add(path, "命令行 PATH")
	}
	patterns := []string{}
	if base := os.Getenv("LOCALAPPDATA"); base != "" {
		patterns = append(patterns, filepath.Join(base, "OpenAI", "Codex", "bin", "*", "codex.exe"), filepath.Join(base, "Programs", "Codex", "resources", "codex.exe"), filepath.Join(base, "Programs", "OpenAI Codex", "resources", "codex.exe"))
	}
	if base := os.Getenv("ProgramFiles"); base != "" {
		patterns = append(patterns, filepath.Join(base, "WindowsApps", "OpenAI.Codex_*", "app", "resources", "codex.exe"))
	}
	for _, pattern := range patterns {
		matches, _ := filepath.Glob(pattern)
		sort.Slice(matches, func(i, j int) bool { return newerVersion(matches[i], matches[j]) })
		for i, p := range matches {
			if i >= 3 {
				break
			}
			add(p, "Codex 桌面版")
		}
	}
	// Explicit Store discovery covers Windows app aliases even when a GUI process has a stale PATH.
	hasDesktop := false
	for _, c := range list {
		if c.Source == "Codex 桌面版" || strings.Contains(c.Path, "OpenAI.Codex_") {
			hasDesktop = true
		}
	}
	if runtime.GOOS == "windows" && !hasDesktop {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		system := os.Getenv("SystemRoot")
		if system != "" {
			exe := filepath.Join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
			cmd := exec.CommandContext(ctx, exe, "-NoProfile", "-NonInteractive", "-Command", "Get-AppxPackage OpenAI.Codex | ForEach-Object { Join-Path $_.InstallLocation 'app\\resources\\codex.exe' }")
			hideCodexWindow(cmd)
			if b, e := cmd.Output(); e == nil && len(b) < 16000 {
				for _, p := range strings.Split(string(b), "\n") {
					add(strings.TrimSpace(p), "Codex 桌面版")
				}
			}
		}
	}
	var wg sync.WaitGroup
	for i := range list {
		wg.Add(1)
		go func(i int) { defer wg.Done(); list[i].Version = probeCodexVersion(list[i].Path) }(i)
	}
	wg.Wait()
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i].Version, list[j].Version
		if a == "" {
			a = filepath.Base(filepath.Dir(list[i].Path))
		}
		if b == "" {
			b = filepath.Base(filepath.Dir(list[j].Path))
		}
		if newerVersion(a, b) {
			return true
		}
		if newerVersion(b, a) {
			return false
		}
		return list[i].Source == "Codex 桌面版" && list[j].Source != "Codex 桌面版"
	})
	return list
}
func detectedCodexPath() (string, error) {
	if p := os.Getenv("RDNEXT_CODEX"); filepath.IsAbs(p) {
		return p, nil
	}
	items := codexInstalls()
	if len(items) == 0 {
		return "", errors.New("未找到本机 Codex。请安装并登录，或在连接设置中选择 codex.exe")
	}
	return items[0].Path, nil
}
func (w *Workspace) codexConnection() (CodexConnection, error) {
	var manual string
	var revision int
	err := w.db.QueryRow("SELECT path,revision FROM codex_connection WHERE id=1").Scan(&manual, &revision)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CodexConnection{}, err
	}
	out := CodexConnection{Automatic: manual == "", Revision: revision, Candidates: []CodexInstall{}}
	if p := os.Getenv("RDNEXT_CODEX"); filepath.IsAbs(p) {
		out.CodexInstall = CodexInstall{Path: p, Source: "指定的 Codex", Version: probeCodexVersion(p)}
		return out, nil
	}
	out.Candidates = codexInstalls()
	if manual != "" {
		out.CodexInstall = CodexInstall{Path: manual, Source: "手动指定"}
		info, e := os.Stat(manual)
		if e != nil || info.IsDir() {
			return out, errors.New("指定的 Codex 已不存在，请重新选择或使用自动检测")
		}
		out.CodexInstall = CodexInstall{Path: manual, Source: "手动指定", Version: probeCodexVersion(manual)}
		return out, nil
	}
	if len(out.Candidates) == 0 {
		return out, errors.New("未找到本机 Codex，请选择 codex.exe")
	}
	out.CodexInstall = out.Candidates[0]
	return out, nil
}
func (w *Workspace) readCodexConnection(rw http.ResponseWriter, r *http.Request) {
	info, e := w.codexConnection()
	if e != nil {
		info.Error = e.Error()
	}
	respond(rw, 200, info)
}
func (w *Workspace) saveCodexConnection(rw http.ResponseWriter, r *http.Request) {
	var in struct {
		Path     string `json:"path"`
		Revision int    `json:"revision"`
	}
	if !readJSON(rw, r, 8192, &in) {
		return
	}
	if in.Path != "" {
		if !filepath.IsAbs(in.Path) || len(in.Path) > 4096 {
			fail(rw, 400, "请选择 Codex 的完整程序路径")
			return
		}
		if runtime.GOOS == "windows" && !strings.EqualFold(filepath.Ext(in.Path), ".exe") {
			fail(rw, 400, "请选择 codex.exe，而非命令行脚本")
			return
		}
		info, e := os.Stat(in.Path)
		if e != nil || info.IsDir() {
			fail(rw, 400, "指定的 Codex 程序不存在")
			return
		}
	}
	w.jobLock.Lock()
	defer w.jobLock.Unlock()
	var current int
	e := w.db.QueryRowContext(r.Context(), "SELECT revision FROM codex_connection WHERE id=1").Scan(&current)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		databaseError(rw, e)
		return
	}
	if current != in.Revision {
		fail(rw, 409, "Codex 连接已变化，请重新读取")
		return
	}
	_, e = w.db.ExecContext(r.Context(), "INSERT INTO codex_connection(id,path) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,revision=codex_connection.revision+1", in.Path)
	if e != nil {
		databaseError(rw, e)
		return
	}
	respond(rw, 200, map[string]any{"revision": current + 1})
}
func (w *Workspace) openCodex(ctx context.Context) (*codexSession, error) {
	info, e := w.codexConnection()
	if e != nil {
		return nil, e
	}
	return isolatedCodexAt(ctx, info.Path)
}

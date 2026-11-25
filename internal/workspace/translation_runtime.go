package workspace

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type translationLauncher struct {
	path string
	args []string
	env  []string
}

func fileExists(name string) bool {
	f, err := os.Stat(name)
	return err == nil && f.Mode().IsRegular()
}

func installedLaunchers(env, name, exeName string) []string {
	var dirs []string
	if override := strings.TrimSpace(os.Getenv(env)); filepath.IsAbs(override) {
		dirs = append(dirs, override)
	}
	dirs = append(dirs, registeredTranslationInstalls(name)...)
	for _, base := range []string{os.Getenv("LOCALAPPDATA"), os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")} {
		if filepath.IsAbs(base) {
			dirs = append(dirs, filepath.Join(base, name), filepath.Join(base, "Programs", name))
		}
	}
	if x, err := exec.LookPath(exeName); err == nil && filepath.IsAbs(x) {
		dirs = append(dirs, filepath.Dir(x))
	}
	if filepath.Separator == '\\' {
		dirs = append(dirs, filepath.Join("D:\\", name))
	}
	return dirs
}

func harnessLauncher() (translationLauncher, error) {
	for _, dir := range installedLaunchers("RDNEXT_HARNESS_DIR", "DeepSeek Harness", "DeepSeek Harness.exe") {
		exe := filepath.Join(dir, "DeepSeek Harness.exe")
		cli := filepath.Join(dir, "resources", "app.asar", "dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "cli.js")
		if fileExists(exe) && fileExists(filepath.Join(dir, "resources", "app.asar")) {
			return translationLauncher{exe, []string{"--expose-internals", cli}, []string{"ELECTRON_RUN_AS_NODE=1"}}, nil
		}
	}
	if exe, err := exec.LookPath("dsh"); err == nil && filepath.IsAbs(exe) && !strings.EqualFold(filepath.Ext(exe), ".cmd") && !strings.EqualFold(filepath.Ext(exe), ".bat") {
		return translationLauncher{path: exe}, nil
	}
	return translationLauncher{}, errors.New("未找到 DeepSeek Harness。请安装官方桌面版或将原生 dsh 放到 PATH")
}

func (v translationLauncher) command(ctx context.Context, dir string, args ...string) *exec.Cmd {
	args = append(append([]string(nil), v.args...), args...)
	cmd := exec.CommandContext(ctx, v.path, args...)
	cmd.Dir = dir
	cmd.Env = append(append(os.Environ(), "NODE_OPTIONS=", "NODE_PATH="), v.env...)
	cmd.WaitDelay = 2 * time.Second
	hideCodexWindow(cmd)
	return cmd
}

type translationOutput struct {
	bytes.Buffer
	max int
}

func (b *translationOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.max {
		return 0, errors.New("翻译响应过长")
	}
	return b.Buffer.Write(p)
}

func runtimeTranslationError(name, raw, fallback string) error {
	s := strings.ToLower(raw)
	for _, item := range []struct {
		needles []string
		message string
	}{
		{[]string{"insufficient", "quota", "credit not enough", "积分不足", "余额不足", "额度不足"}, "额度或余额不足，请检查账号"},
		{[]string{"401", "not logged in", "not authenticated", "authentication required", "please use /login", "please log in", "please run /login", "api key", "no credential", "unauthorized", "未登录", "未配置密钥"}, "需要登录或配置模型凭据"},
		{[]string{"unknown option", "unknown flag", "unrecognized option"}, "当前本机 CLI 不支持这组无头翻译参数，请更新客户端"},
		{[]string{"invalid model", "model not found", "unknown model", "service info not found"}, "找不到所选模型"},
	} {
		for _, needle := range item.needles {
			if strings.Contains(s, needle) {
				return errors.New(name + "：" + item.message)
			}
		}
	}
	return errors.New(name + "：" + fallback)
}

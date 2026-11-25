package workspace

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCodexDiscoveryDoesNotStopAtOldPATH(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows discovery")
	}
	root := t.TempDir()
	old := filepath.Join(root, "old-cli")
	newer := filepath.Join(root, "local", "OpenAI", "Codex", "bin", "10.0.0", "codex.exe")
	for _, p := range []string{filepath.Join(old, "codex.exe"), newer} {
		if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("fixture"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("SystemRoot", filepath.Join(root, "system"))
	t.Setenv("ProgramFiles", filepath.Join(root, "programs"))
	t.Setenv("RDNEXT_CODEX", "")
	t.Setenv("PATH", old)
	t.Setenv("LOCALAPPDATA", filepath.Join(root, "local"))
	got, err := codexPath()
	if err != nil {
		t.Fatal(err)
	}
	if got != newer {
		t.Fatalf("selected old PATH Codex %q instead of newer desktop Codex %q", got, newer)
	}
}

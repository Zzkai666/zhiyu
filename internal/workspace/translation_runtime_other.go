//go:build !windows

package workspace

import "os/exec"

func registeredTranslationInstalls(string) []string { return nil }
func startOwnedTranslationProcess(cmd *exec.Cmd) (func(), error) {
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return func() { _ = cmd.Process.Kill() }, nil
}

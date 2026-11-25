//go:build !windows

package workspace

import "os/exec"

func hideCodexWindow(_ *exec.Cmd) {}

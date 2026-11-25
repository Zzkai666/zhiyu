package workspace

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

func registeredTranslationInstalls(name string) []string {
	var paths []string
	for _, hive := range []registry.Key{registry.CURRENT_USER, registry.LOCAL_MACHINE} {
		key, err := registry.OpenKey(hive, `Software\Microsoft\Windows\CurrentVersion\Uninstall`, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue
		}
		subkeys, _ := key.ReadSubKeyNames(-1)
		for _, k := range subkeys {
			entry, err := registry.OpenKey(key, k, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			label, _, _ := entry.GetStringValue("DisplayName")
			if strings.EqualFold(label, name) || strings.HasPrefix(strings.ToLower(label), strings.ToLower(name)+" ") {
				dir, _, _ := entry.GetStringValue("InstallLocation")
				dir = strings.Trim(dir, `"`)
				if filepath.IsAbs(dir) {
					paths = append(paths, dir)
				}
				if icon, _, _ := entry.GetStringValue("DisplayIcon"); icon != "" {
					icon, _, _ = strings.Cut(icon, ",")
					icon = strings.Trim(icon, `"`)
					if filepath.IsAbs(icon) {
						paths = append(paths, filepath.Dir(icon))
					}
				}
			}
			entry.Close()
		}
		key.Close()
	}
	return paths
}

func startOwnedTranslationProcess(cmd *exec.Cmd) (func(), error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}
	var limit windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	limit.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limit)), uint32(unsafe.Sizeof(limit))); err != nil {
		windows.CloseHandle(job)
		return nil, err
	}
	runtime.KeepAlive(&limit)
	var once sync.Once
	closeJob := func() { once.Do(func() { windows.CloseHandle(job) }) }
	cmd.Cancel = func() error { closeJob(); return cmd.Process.Kill() }
	if err = cmd.Start(); err != nil {
		closeJob()
		return nil, err
	}
	process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err == nil {
		err = windows.AssignProcessToJobObject(job, process)
		windows.CloseHandle(process)
	}
	if err != nil {
		closeJob()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return nil, err
	}
	return closeJob, nil
}

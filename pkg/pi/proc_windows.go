//go:build windows

package pi

import (
	"os/exec"
	"syscall"
)

// setSysProcAttr hides the child console window on Windows so spawning
// node/cli.js does not pop up a terminal window.
func setSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}

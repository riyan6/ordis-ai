//go:build !windows

package pi

import (
	"os/exec"
)

// setSysProcAttr is a no-op on non-Windows platforms.
func setSysProcAttr(cmd *exec.Cmd) {
}

package pi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseCmdShim(t *testing.T) {
	content := `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\node.exe" (
  SET "_prog=%dp0%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" %*
`
	// 模拟临时目录
	dir := t.TempDir()
	shim := filepath.Join(dir, "pi.cmd")
	if err := os.WriteFile(shim, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	// create the expected cli.js so fileExists() passes
	cliPath := filepath.Join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js")
	if err := os.MkdirAll(filepath.Dir(cliPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cliPath, []byte("// stub"), 0o644); err != nil {
		t.Fatal(err)
	}

	inv, err := resolvePiCommand(shim)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if inv.ViaCmd {
		t.Fatalf("expected direct node invocation, got cmd wrapper")
	}
	if !strings.HasSuffix(strings.ToLower(inv.Executable), "node.exe") && !strings.HasSuffix(strings.ToLower(inv.Executable), "node") {
		t.Errorf("executable = %q, want node", inv.Executable)
	}
	script := inv.Args[0]
	if !strings.Contains(script, "pi-coding-agent") || !strings.Contains(script, "cli.js") {
		t.Errorf("script = %q, want pi cli.js", script)
	}
	t.Logf("resolved: %s %s", inv.Executable, script)
}

func TestResolveNonCmd(t *testing.T) {
	inv, err := resolvePiCommand("pi.exe")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if inv.ViaCmd {
		t.Errorf("pi.exe should be direct")
	}
}

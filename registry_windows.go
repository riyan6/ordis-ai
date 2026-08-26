//go:build windows

package main

import (
	"golang.org/x/sys/windows/registry"
)

// readRegistryImpl reads an environment variable value from the Windows
// registry. Scope is "HKCU" (user) or "HKLM" (machine), matching the
// Environment\ key where explorer.exe stores persistent env vars.
func readRegistryImpl(scope, name string) (string, bool) {
	root := registry.CURRENT_USER
	sub := `Environment`
	if scope == "HKLM" {
		root = registry.LOCAL_MACHINE
		sub = `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`
	}
	k, err := registry.OpenKey(root, sub, registry.QUERY_VALUE)
	if err != nil {
		return "", false
	}
	defer k.Close()
	v, _, err := k.GetStringValue(name)
	if err != nil {
		return "", false
	}
	return v, true
}

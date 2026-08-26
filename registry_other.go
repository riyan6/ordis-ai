//go:build !windows

package main

// readRegistryImpl is a no-op on non-Windows platforms.
func readRegistryImpl(scope, name string) (string, bool) {
	return "", false
}

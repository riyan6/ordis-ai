package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestListAndDeleteProvider(t *testing.T) {
	agentDir := t.TempDir()
	t.Setenv("PI_AGENT_DIR", agentDir)
	writeTestJSON(t, filepath.Join(agentDir, "auth.json"), map[string]any{
		"opencode":    map[string]any{"type": "api_key", "key": "secret"},
		"commandcode": map[string]any{"type": "api_key", "key": "keep"},
	})
	writeTestJSON(t, filepath.Join(agentDir, "models.json"), map[string]any{
		"providers": map[string]any{
			"opencode":    map[string]any{"models": []any{}},
			"commandcode": map[string]any{"models": []any{}},
		},
		"version": 1,
	})
	writeTestJSON(t, filepath.Join(agentDir, "settings.json"), map[string]any{
		"defaultProvider": "opencode",
		"defaultModel":    "some-model",
		"theme":           "dark",
	})

	providers, err := (&App{}).ListProviders()
	if err != nil {
		t.Fatalf("ListProviders: %v", err)
	}
	var opencode ProviderInfo
	for _, provider := range providers {
		if provider.ID == "opencode" {
			opencode = provider
		}
	}
	if !opencode.HasCredential || !opencode.HasCustomConfig || !opencode.Default || !opencode.Deletable {
		t.Fatalf("unexpected opencode info: %#v", opencode)
	}

	remaining, err := (&App{}).DeleteProvider("opencode")
	if err != nil {
		t.Fatalf("DeleteProvider: %v", err)
	}
	var disabled ProviderInfo
	for _, provider := range remaining {
		if provider.ID == "opencode" {
			disabled = provider
		}
	}
	if !disabled.Disabled || disabled.Deletable {
		t.Fatalf("deleted provider was not disabled: %#v", disabled)
	}

	auth := readTestObject(t, filepath.Join(agentDir, "auth.json"))
	if _, ok := auth["opencode"]; ok {
		t.Fatal("opencode credential was not removed")
	}
	if _, ok := auth["commandcode"]; !ok {
		t.Fatal("unrelated credential was removed")
	}

	models := readTestObject(t, filepath.Join(agentDir, "models.json"))
	var modelProviders map[string]json.RawMessage
	if err := json.Unmarshal(models["providers"], &modelProviders); err != nil {
		t.Fatal(err)
	}
	if _, ok := modelProviders["opencode"]; ok {
		t.Fatal("opencode models configuration was not removed")
	}
	if _, ok := modelProviders["commandcode"]; !ok {
		t.Fatal("unrelated models configuration was removed")
	}
	if _, ok := models["version"]; !ok {
		t.Fatal("unrelated models.json field was removed")
	}

	settings := readTestObject(t, filepath.Join(agentDir, "settings.json"))
	if _, ok := settings["defaultProvider"]; ok {
		t.Fatal("deleted provider remained the default")
	}
	if _, ok := settings["defaultModel"]; ok {
		t.Fatal("deleted provider model remained the default")
	}
	if decodeJSONString(settings["theme"]) != "dark" {
		t.Fatal("unrelated settings field was changed")
	}

	preferences := readTestObject(t, filepath.Join(agentDir, providerPreferencesFile))
	var disabledProviders []string
	if err := json.Unmarshal(preferences["disabledProviders"], &disabledProviders); err != nil {
		t.Fatal(err)
	}
	if len(disabledProviders) != 1 || disabledProviders[0] != "opencode" {
		t.Fatalf("unexpected disabled providers: %#v", disabledProviders)
	}
}

func TestDeleteRuntimeProvider(t *testing.T) {
	agentDir := t.TempDir()
	t.Setenv("PI_AGENT_DIR", agentDir)
	writeTestJSON(t, filepath.Join(agentDir, "settings.json"), map[string]any{
		"defaultProvider": "environment-only",
		"defaultModel":    "runtime-model",
	})

	providers, err := (&App{}).DeleteProvider("environment-only")
	if err != nil {
		t.Fatalf("DeleteProvider: %v", err)
	}
	if len(providers) != 1 || !providers[0].Disabled {
		t.Fatalf("runtime provider was not disabled: %#v", providers)
	}
	settings := readTestObject(t, filepath.Join(agentDir, "settings.json"))
	if _, ok := settings["defaultProvider"]; ok {
		t.Fatal("disabled runtime provider remained the default")
	}

	if _, err := (&App{}).DeleteProvider("../auth"); err == nil {
		t.Fatal("expected invalid provider id to fail")
	}
}

func writeTestJSON(t *testing.T, path string, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func readTestObject(t *testing.T, path string) map[string]json.RawMessage {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]json.RawMessage
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var providerIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

const providerPreferencesFile = "ordis-ai-providers.json"

// ProviderInfo describes persisted Pi provider configuration without exposing
// credentials or model configuration secrets to the frontend.
type ProviderInfo struct {
	ID              string `json:"id"`
	HasCredential   bool   `json:"hasCredential"`
	CredentialType  string `json:"credentialType,omitempty"`
	HasCustomConfig bool   `json:"hasCustomConfig"`
	Default         bool   `json:"default"`
	Deletable       bool   `json:"deletable"`
	Disabled        bool   `json:"disabled"`
}

// ListProviders returns the persisted providers configured in Pi's auth,
// models, and settings files. Secret values are never decoded into the result.
func (a *App) ListProviders() ([]ProviderInfo, error) {
	return listProvidersFromDir(piAgentDir())
}

// DeleteProvider removes persisted Pi configuration and disables the provider
// in ordis-ai so built-in and cached runtime models stay out of the GUI.
func (a *App) DeleteProvider(providerID string) ([]ProviderInfo, error) {
	providerID = strings.TrimSpace(providerID)
	if !providerIDPattern.MatchString(providerID) {
		return nil, fmt.Errorf("invalid provider id")
	}

	a.switchMu.Lock()
	defer a.switchMu.Unlock()

	updates, changed, err := buildProviderDeletion(piAgentDir(), providerID)
	if err != nil {
		return nil, err
	}
	if !changed {
		return nil, fmt.Errorf("provider %q is already disabled", providerID)
	}
	if err := applyConfigUpdates(updates); err != nil {
		return nil, err
	}

	wasRunning := a.manager != nil && a.manager.IsRunning()
	if wasRunning {
		a.mu.Lock()
		workspace := a.ws
		a.mu.Unlock()
		if err := a.restartPiIn(workspace); err != nil {
			return nil, fmt.Errorf("provider was deleted, but Pi restart failed: %w", err)
		}
	}
	return listProvidersFromDir(piAgentDir())
}

func listProvidersFromDir(agentDir string) ([]ProviderInfo, error) {
	byID := map[string]*ProviderInfo{}
	auth, _, err := readRawObject(filepath.Join(agentDir, "auth.json"))
	if err != nil {
		return nil, fmt.Errorf("read auth.json: %w", err)
	}
	for id, raw := range auth {
		item := providerInfo(byID, id)
		item.HasCredential = true
		var credential struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(raw, &credential) == nil {
			item.CredentialType = credential.Type
		}
	}

	modelsFile, _, err := readRawObject(filepath.Join(agentDir, "models.json"))
	if err != nil {
		return nil, fmt.Errorf("read models.json: %w", err)
	}
	var modelProviders map[string]json.RawMessage
	if raw := modelsFile["providers"]; len(raw) > 0 {
		if err := json.Unmarshal(raw, &modelProviders); err != nil {
			return nil, fmt.Errorf("read models.json providers: %w", err)
		}
	}
	for id := range modelProviders {
		providerInfo(byID, id).HasCustomConfig = true
	}

	settings, _, err := readRawObject(filepath.Join(agentDir, "settings.json"))
	if err != nil {
		return nil, fmt.Errorf("read settings.json: %w", err)
	}
	defaultProvider := decodeJSONString(settings["defaultProvider"])
	if defaultProvider != "" {
		providerInfo(byID, defaultProvider).Default = true
	}

	disabled, err := readDisabledProviders(agentDir)
	if err != nil {
		return nil, err
	}
	for id := range disabled {
		providerInfo(byID, id).Disabled = true
	}

	out := make([]ProviderInfo, 0, len(byID))
	for _, item := range byID {
		item.Deletable = !item.Disabled
		out = append(out, *item)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Default != out[j].Default {
			return out[i].Default
		}
		return strings.ToLower(out[i].ID) < strings.ToLower(out[j].ID)
	})
	return out, nil
}

func providerInfo(items map[string]*ProviderInfo, id string) *ProviderInfo {
	if item := items[id]; item != nil {
		return item
	}
	item := &ProviderInfo{ID: id}
	items[id] = item
	return item
}

type configUpdate struct {
	path     string
	original []byte
	updated  []byte
	perm     os.FileMode
}

func buildProviderDeletion(agentDir, providerID string) ([]configUpdate, bool, error) {
	var updates []configUpdate
	changed := false

	authPath := filepath.Join(agentDir, "auth.json")
	auth, authOriginal, err := readRawObject(authPath)
	if err != nil {
		return nil, false, fmt.Errorf("read auth.json: %w", err)
	}
	if _, ok := auth[providerID]; ok {
		delete(auth, providerID)
		update, err := makeConfigUpdate(authPath, authOriginal, auth)
		if err != nil {
			return nil, false, err
		}
		updates = append(updates, update)
		changed = true
	}

	modelsPath := filepath.Join(agentDir, "models.json")
	modelsFile, modelsOriginal, err := readRawObject(modelsPath)
	if err != nil {
		return nil, false, fmt.Errorf("read models.json: %w", err)
	}
	var modelProviders map[string]json.RawMessage
	if raw := modelsFile["providers"]; len(raw) > 0 {
		if err := json.Unmarshal(raw, &modelProviders); err != nil {
			return nil, false, fmt.Errorf("read models.json providers: %w", err)
		}
	}
	if _, ok := modelProviders[providerID]; ok {
		delete(modelProviders, providerID)
		raw, err := json.Marshal(modelProviders)
		if err != nil {
			return nil, false, err
		}
		modelsFile["providers"] = raw
		update, err := makeConfigUpdate(modelsPath, modelsOriginal, modelsFile)
		if err != nil {
			return nil, false, err
		}
		updates = append(updates, update)
		changed = true
	}

	preferencesPath := filepath.Join(agentDir, providerPreferencesFile)
	preferences, preferencesOriginal, err := readRawObject(preferencesPath)
	if err != nil {
		return nil, false, fmt.Errorf("read %s: %w", providerPreferencesFile, err)
	}
	var disabledProviders []string
	if raw := preferences["disabledProviders"]; len(raw) > 0 {
		if err := json.Unmarshal(raw, &disabledProviders); err != nil {
			return nil, false, fmt.Errorf("read disabled providers: %w", err)
		}
	}
	disabled := make(map[string]struct{}, len(disabledProviders)+1)
	for _, id := range disabledProviders {
		disabled[id] = struct{}{}
	}
	if _, exists := disabled[providerID]; !exists {
		disabledProviders = append(disabledProviders, providerID)
		sort.Strings(disabledProviders)
		raw, err := json.Marshal(disabledProviders)
		if err != nil {
			return nil, false, err
		}
		preferences["disabledProviders"] = raw
		update, err := makeConfigUpdate(preferencesPath, preferencesOriginal, preferences)
		if err != nil {
			return nil, false, err
		}
		updates = append(updates, update)
		changed = true
	}

	if changed {
		settingsPath := filepath.Join(agentDir, "settings.json")
		settings, settingsOriginal, err := readRawObject(settingsPath)
		if err != nil {
			return nil, false, fmt.Errorf("read settings.json: %w", err)
		}
		if decodeJSONString(settings["defaultProvider"]) == providerID {
			delete(settings, "defaultProvider")
			delete(settings, "defaultModel")
			update, err := makeConfigUpdate(settingsPath, settingsOriginal, settings)
			if err != nil {
				return nil, false, err
			}
			updates = append(updates, update)
		}
	}
	return updates, changed, nil
}

func readDisabledProviders(agentDir string) (map[string]struct{}, error) {
	preferences, _, err := readRawObject(filepath.Join(agentDir, providerPreferencesFile))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", providerPreferencesFile, err)
	}
	var ids []string
	if raw := preferences["disabledProviders"]; len(raw) > 0 {
		if err := json.Unmarshal(raw, &ids); err != nil {
			return nil, fmt.Errorf("read disabled providers: %w", err)
		}
	}
	disabled := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if providerIDPattern.MatchString(id) {
			disabled[id] = struct{}{}
		}
	}
	return disabled, nil
}

func readRawObject(path string) (map[string]json.RawMessage, []byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]json.RawMessage{}, nil, nil
		}
		return nil, nil, err
	}
	var value map[string]json.RawMessage
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, nil, err
	}
	return value, data, nil
}

func decodeJSONString(raw json.RawMessage) string {
	var value string
	_ = json.Unmarshal(raw, &value)
	return value
}

func makeConfigUpdate(path string, original []byte, value any) (configUpdate, error) {
	updated, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return configUpdate{}, err
	}
	updated = append(updated, '\n')
	perm := os.FileMode(0o600)
	if info, err := os.Stat(path); err == nil {
		perm = info.Mode().Perm()
	}
	return configUpdate{path: path, original: original, updated: updated, perm: perm}, nil
}

func applyConfigUpdates(updates []configUpdate) error {
	applied := 0
	for i := range updates {
		if bytes.Equal(updates[i].original, updates[i].updated) {
			continue
		}
		if err := writeFileAtomic(updates[i].path, updates[i].updated, updates[i].perm); err != nil {
			for j := applied - 1; j >= 0; j-- {
				if updates[j].original == nil {
					_ = os.Remove(updates[j].path)
					continue
				}
				_ = writeFileAtomic(updates[j].path, updates[j].original, updates[j].perm)
			}
			return fmt.Errorf("update %s: %w", filepath.Base(updates[i].path), err)
		}
		updates[applied] = updates[i]
		applied++
	}
	return nil
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".ordis-ai-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

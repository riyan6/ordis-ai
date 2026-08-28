package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"ordis-ai/pkg/pi"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Snapshot is the initial state payload the frontend fetches on mount.
// State/Messages/Models carry decoded JSON, not raw bytes.
type Snapshot struct {
	Running   bool   `json:"running"`
	Workspace string `json:"workspace"`
	CoreType  string `json:"coreType"`
	State     any    `json:"state,omitempty"`
	Messages  any    `json:"messages,omitempty"`
	Models    any    `json:"models,omitempty"`
	LastError string `json:"lastError,omitempty"`
}

// CoreInfo describes a supported agent core and its availability.
type CoreInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Available   bool   `json:"available"`
	Path        string `json:"path"`
	AgentDir    string `json:"agentDir"`
}

// WorkspaceInfo describes the currently opened project directory.
type WorkspaceInfo struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

// SessionInfo describes a persisted pi session for the history list.
type SessionInfo struct {
	ID           string `json:"id"`
	Name         string `json:"name"`      // display name (session name or fallback)
	Path         string `json:"path"`      // absolute .jsonl path (for switch_session)
	Workspace    string `json:"workspace"` // cwd of the session
	UpdatedAt    int64  `json:"updatedAt"` // unix millis, file mtime
	MessageCount int    `json:"messageCount"`
}

// WorkspaceRecord is a registered (or auto-discovered) workspace root.
type WorkspaceRecord struct {
	ID           string `json:"id"`
	Path         string `json:"path"`
	Name         string `json:"name"`
	Pinned       bool   `json:"pinned"`
	LastOpenedAt string `json:"lastOpenedAt,omitempty"`
}

// WorkspaceSnapshot is the frontend binding for workspace list + count.
type WorkspaceListResult struct {
	Workspaces []WorkspaceRecord `json:"workspaces"`
	Current    string            `json:"current"` // path of the active pi cwd
}

// App is the Wails application root.
type App struct {
	ctx      context.Context
	mu       sync.Mutex
	switchMu sync.Mutex
	manager  *pi.Manager
	ws       string // current workspace dir
	coreType string // "pi" or "omp"
	lastErr  string
	started  bool
}

// NewApp creates the application.
func NewApp() *App {
	return &App{}
}

// startup wires the Pi/Omp manager and event forwarding into Wails.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	settings := readOrdisSettings()
	a.mu.Lock()
	a.ws = defaultWorkspace()
	a.coreType = settings.CoreType
	if envCore := os.Getenv("ORDIS_AGENT_CORE"); envCore != "" {
		envCore = strings.ToLower(strings.TrimSpace(envCore))
		if envCore == pi.CoreTypeOmp || envCore == pi.CoreTypePi {
			a.coreType = envCore
		}
	}
	if a.coreType == "" {
		a.coreType = pi.CoreTypePi
	}
	a.mu.Unlock()
	a.manager = pi.NewManager(a.onPiEvent, a.onPiExit, a.onPiStderr)
}

// onPiEvent forwards a Pi JSONL event to the frontend.
//
// CRITICAL: EventsEmit receives json.RawMessage (a []byte) here. Wails
// serializes event data with encoding/json, which turns []byte into a
// BASE64 STRING — the frontend would get "eyJ0eXBlIjoi..." instead of
// the event object, JSON.parse would fail, and every event would be
// silently dropped (no streaming, no thinking, no stop button).
// Decode to any first so the payload arrives as a proper JSON value.
func (a *App) onPiEvent(raw json.RawMessage, ev *pi.Event) {
	if a.ctx == nil {
		return
	}
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return // skip malformed lines
	}
	wailsruntime.EventsEmit(a.ctx, "pi:event", payload)
}

// onPiExit notifies the frontend that the pi subprocess exited.
func (a *App) onPiExit(code int, signal string) {
	if a.ctx == nil {
		return
	}
	a.mu.Lock()
	a.lastErr = fmt.Sprintf("pi exited (code=%d signal=%s)", code, signal)
	a.mu.Unlock()
	payload := map[string]any{"code": code, "signal": signal}
	wailsruntime.EventsEmit(a.ctx, "pi:exit", payload)
}

func (a *App) onPiStderr(line string) {
	if a.ctx == nil {
		return
	}
	wailsruntime.EventsEmit(a.ctx, "pi:stderr", line)
}

// StartPi spawns pi --mode rpc in the default/current workspace.
func (a *App) StartPi() error {
	return a.startPiLocked("")
}

func (a *App) startPiLocked(workspace string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.manager == nil {
		a.manager = pi.NewManager(a.onPiEvent, a.onPiExit, a.onPiStderr)
	}
	if a.manager.IsRunning() {
		return nil
	}
	ws := workspace
	if ws == "" {
		ws = a.ws
	}
	if ws == "" {
		ws = defaultWorkspace()
	}
	if _, err := os.Stat(ws); err != nil {
		return fmt.Errorf("workspace does not exist: %s", ws)
	}

	ct := a.coreType
	if ct == "" {
		ct = readOrdisSettings().CoreType
	}
	if ct == "" {
		ct = pi.CoreTypePi
	}

	var args []string
	if ct == pi.CoreTypeOmp {
		args = []string{"--auto-approve", "--allow-home"}
	} else {
		// Trust project-local .pi/agent files for this run (same behavior
		// as `pi -a`), keep sessions persistent.
		args = []string{"--approve"}
	}

	env := mergeEnvFallbacks()
	if _, err := a.manager.StartInWithCore(ws, ct, args, env); err != nil {
		a.lastErr = err.Error()
		return err
	}
	a.ws = ws
	a.coreType = ct
	a.lastErr = ""
	a.started = true
	return nil
}

// StopPi terminates the pi subprocess.
func (a *App) StopPi() {
	if a.manager != nil {
		a.manager.Abort()
	}
}

// GetSnapshot returns the current state for initial UI render.
func (a *App) GetSnapshot() Snapshot {
	return a.getSnapshot(true)
}

// getSnapshot can skip the model list on latency-sensitive switch paths.
// State and messages are independent RPC calls, so fetch them concurrently.
func (a *App) getSnapshot(includeModels bool) Snapshot {
	a.mu.Lock()
	manager := a.manager
	ct := a.coreType
	if ct == "" {
		ct = pi.CoreTypePi
	}
	snap := Snapshot{
		Running:   manager != nil && manager.IsRunning(),
		Workspace: a.ws,
		CoreType:  ct,
		LastError: a.lastErr,
	}
	a.mu.Unlock()
	if snap.Running {
		var state, messages, models any
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			// Note: resp.Data is the `data` field payload, not the full
			// response envelope — decode it directly.
			if resp, err := manager.Request(pi.Command{Type: "get_state"}, 8*time.Second); err == nil && resp != nil && resp.Success {
				var st any
				_ = json.Unmarshal(resp.Data, &st)
				state = st
			}
		}()
		go func() {
			defer wg.Done()
			if resp, err := manager.Request(pi.Command{Type: "get_messages"}, 8*time.Second); err == nil && resp != nil && resp.Success {
				var msgs struct {
					Messages any `json:"messages"`
				}
				if json.Unmarshal(resp.Data, &msgs) == nil {
					messages = msgs.Messages
				}
			}
		}()
		if includeModels {
			wg.Add(1)
			go func() {
				defer wg.Done()
				models = a.fetchModelsFast()
			}()
		}
		wg.Wait()
		snap.State = state
		snap.Messages = messages
		snap.Models = models
	}
	return snap
}

// fetchModelsFast returns whatever the model snapshot currently holds,
// with a single short query and NO long retry loop. Model availability
// refreshes asynchronously inside pi; blocking here (previously up to
// ~30s across 4 attempts) made workspace/session switches appear frozen
// on "加载中". The UI prefers a quick snapshot and refreshes later.
func (a *App) fetchModelsFast() any {
	resp, err := a.manager.Request(pi.Command{Type: "get_available_models"}, 4*time.Second)
	if err != nil {
		return nil
	}
	var mods struct {
		Models any `json:"models"`
	}
	if json.Unmarshal(resp.Data, &mods) != nil {
		return nil
	}
	return mods.Models
}

// fetchModels pulls the model list, waiting briefly for the async
// availability refresh to populate the snapshot on fresh startups.
func (a *App) fetchModels() any {
	for attempt := 0; attempt < 4; attempt++ {
		resp, err := a.manager.Request(pi.Command{Type: "get_available_models"}, 6*time.Second)
		if err != nil {
			return nil
		}
		var mods struct {
			Models any `json:"models"`
		}
		if json.Unmarshal(resp.Data, &mods) != nil {
			return nil
		}
		if list, ok := mods.Models.([]any); ok && len(list) > 0 {
			return mods.Models
		}
		// Snapshot still empty: the refresh is async. Wait and retry.
		time.Sleep(1200 * time.Millisecond)
	}
	return nil
}

// GetWorkspace returns the current workspace info.
func (a *App) GetWorkspace() WorkspaceInfo {
	a.mu.Lock()
	defer a.mu.Unlock()
	name := filepath.Base(a.ws)
	if a.ws == "" || a.ws == "." {
		name = "Default"
	}
	return WorkspaceInfo{Path: a.ws, Name: name}
}

// workspaceStorePath is where we persist the workspace registry.
// Overridable for tests (ORDIS_WS_STORE) so automated tests never
// pollute the user's real workspace list.
func workspaceStorePath() string {
	if p := os.Getenv("ORDIS_WS_STORE"); p != "" {
		return p
	}
	piPath := filepath.Join(agentDirForCore(pi.CoreTypePi), "ordis-ai-workspaces.json")
	if fileExists(piPath) {
		return piPath
	}
	return filepath.Join(ordisConfigDir(), "ordis-ai-workspaces.json")
}

// ListWorkspaces returns registered workspaces merged with workspaces
// auto-discovered from session cwds. The active pi cwd is included.
//
// Dedup is done on NORMALIZED paths; entries whose directory no longer
// exists (e.g. old Temp test dirs) are dropped so the list does not
// grow stale.
func (a *App) ListWorkspaces() (WorkspaceListResult, error) {
	// 1. Registered (pinned) workspaces from our store.
	registered, _ := readWorkspaceStore()

	// 2. Merge in workspaces discovered from session cwds.
	sessions, _ := a.ListSessions()
	byPath := map[string]*WorkspaceRecord{}
	for i := range registered {
		byPath[normalizePath(registered[i].Path)] = &registered[i]
	}
	for _, s := range sessions {
		if s.Workspace == "" {
			continue
		}
		key := normalizePath(s.Workspace)
		if _, ok := byPath[key]; ok {
			continue
		}
		byPath[key] = &WorkspaceRecord{
			Path:   s.Workspace,
			Name:   filepath.Base(s.Workspace),
			Pinned: false,
		}
	}

	out := make([]WorkspaceRecord, 0, len(byPath))
	for _, w := range byPath {
		// Drop entries that no longer exist on disk (stale Temp dirs
		// from tests, deleted folders, etc.) — keeps the rail clean.
		if w.Path != "" {
			if st, err := os.Stat(w.Path); err != nil || !st.IsDir() {
				continue
			}
		}
		out = append(out, *w)
	}
	// Sort: pinned first, then by name; active highlighted in UI by path.
	sort.Slice(out, func(i, j int) bool {
		if out[i].Pinned != out[j].Pinned {
			return out[i].Pinned
		}
		return out[i].Name < out[j].Name
	})

	a.mu.Lock()
	cur := a.ws
	a.mu.Unlock()
	return WorkspaceListResult{Workspaces: out, Current: cur}, nil
}

// AddWorkspace registers a user-selected folder as a workspace and
// returns the updated workspace list. The folder must exist.
func (a *App) AddWorkspace(path string) (WorkspaceListResult, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return WorkspaceListResult{}, fmt.Errorf("path is empty")
	}
	st, err := os.Stat(path)
	if err != nil || !st.IsDir() {
		return WorkspaceListResult{}, fmt.Errorf("not a directory: %s", path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return WorkspaceListResult{}, err
	}

	ws, err := readWorkspaceStore()
	if err != nil {
		return WorkspaceListResult{}, err
	}
	found := false
	for i := range ws {
		if samePath(ws[i].Path, abs) {
			ws[i].Pinned = true
			ws[i].LastOpenedAt = time.Now().Format(time.RFC3339)
			found = true
			break
		}
	}
	if !found {
		ws = append(ws, WorkspaceRecord{
			ID:           workspaceID(abs),
			Path:         abs,
			Name:         filepath.Base(abs),
			Pinned:       true,
			LastOpenedAt: time.Now().Format(time.RFC3339),
		})
	}
	if err := writeWorkspaceStore(ws); err != nil {
		return WorkspaceListResult{}, err
	}
	return a.ListWorkspaces()
}

// AddWorkspaceDialog opens a folder picker, registers the chosen folder
// as a workspace (without switching to it), and returns the list.
func (a *App) AddWorkspaceDialog() (WorkspaceListResult, error) {
	dir, err := wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "添加工作区",
	})
	if err != nil {
		return WorkspaceListResult{}, err
	}
	if dir == "" {
		return a.ListWorkspaces() // user cancelled
	}
	return a.AddWorkspace(dir)
}

// SwitchWorkspace restarts the pi process in the given workspace (so
// new conversations live there) and returns the fresh snapshot.
func (a *App) SwitchWorkspace(path string) (Snapshot, error) {
	a.switchMu.Lock()
	defer a.switchMu.Unlock()
	if _, err := os.Stat(path); err != nil {
		return Snapshot{}, fmt.Errorf("workspace does not exist: %s", path)
	}
	a.mu.Lock()
	current := a.ws
	a.mu.Unlock()
	if samePath(current, path) && a.manager != nil && a.manager.IsRunning() {
		return a.getSnapshot(false), nil
	}
	if err := a.restartPiIn(path); err != nil {
		return Snapshot{}, err
	}
	return a.getSnapshot(false), nil
}

// samePath compares two paths case-insensitively on Windows with
// normalized separators and trailing-slash trimming. Workspace paths
// come from different sources (registered store, session cwds, the
// folder picker) that can differ in case or trailing separator.
func samePath(a, b string) bool {
	na := normalizePath(a)
	nb := normalizePath(b)
	return na == nb
}

// normalizePath canonicalizes a path for comparison: backslashes to
// forward slashes, trailing slashes trimmed, lowercased on Windows.
func normalizePath(p string) string {
	out := filepath.ToSlash(filepath.Clean(p))
	out = strings.TrimRight(out, "/")
	if runtime.GOOS == "windows" {
		out = strings.ToLower(out)
	}
	return out
}

// workspaceID derives a stable id from an absolute path.
func workspaceID(path string) string {
	return fmt.Sprintf("%x", fnv32(path))
}

func fnv32(s string) uint32 {
	var h uint32 = 2166136261
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 16777619
	}
	return h
}

// readWorkspaceStore loads the registry from disk.
func readWorkspaceStore() ([]WorkspaceRecord, error) {
	data, err := os.ReadFile(workspaceStorePath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var store struct {
		Workspaces []WorkspaceRecord `json:"workspaces"`
	}
	if err := json.Unmarshal(data, &store); err != nil {
		return nil, err
	}
	return store.Workspaces, nil
}

// writeWorkspaceStore persists the registry atomically.
func writeWorkspaceStore(ws []WorkspaceRecord) error {
	store := map[string]any{"workspaces": ws}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	tmp := workspaceStorePath() + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, workspaceStorePath())
}

// ListSessions scans the session directories for all supported agent cores
// (~/.pi/agent/sessions, ~/.omp/agent/sessions) and returns persisted sessions.
// Results are deduplicated and sorted by most-recently-modified first.
func (a *App) ListSessions() ([]SessionInfo, error) {
	dirs := []string{
		filepath.Join(agentDirForCore(pi.CoreTypePi), "sessions"),
		filepath.Join(agentDirForCore(pi.CoreTypeOmp), "sessions"),
	}

	seenPaths := map[string]bool{}
	var out []SessionInfo

	for _, sessionsRoot := range dirs {
		if !fileExists(sessionsRoot) && !isDir(sessionsRoot) {
			continue
		}
		_ = filepath.WalkDir(sessionsRoot, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil // skip unreadable entries
			}
			if d.IsDir() || !strings.HasSuffix(strings.ToLower(d.Name()), ".jsonl") {
				return nil
			}
			norm := normalizePath(path)
			if seenPaths[norm] {
				return nil
			}
			seenPaths[norm] = true

			info, err := d.Info()
			if err != nil {
				return nil
			}
			meta := readSessionMeta(path)
			out = append(out, SessionInfo{
				ID:           meta.ID,
				Name:         meta.Name,
				Path:         path,
				Workspace:    meta.Cwd,
				UpdatedAt:    info.ModTime().UnixMilli(),
				MessageCount: meta.MessageCount,
			})
			return nil
		})
	}

	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	if len(out) > 300 {
		out = out[:300]
	}
	return out, nil
}

// ResumeSession switches the running pi session to the given session
// file and returns the refreshed snapshot (messages of that session).
//
// Pi reconstructs its cwd-bound runtime when switch_session loads a target
// from another workspace, so the existing subprocess can be reused.
func (a *App) ResumeSession(sessionPath string) (Snapshot, error) {
	a.switchMu.Lock()
	defer a.switchMu.Unlock()
	if !fileExists(sessionPath) {
		return Snapshot{}, fmt.Errorf("session file not found: %s", sessionPath)
	}
	meta := readSessionMeta(sessionPath)
	if a.manager == nil || !a.manager.IsRunning() {
		return Snapshot{}, fmt.Errorf("pi is not running — start it first")
	}
	resp, err := a.manager.Request(pi.Command{Type: "switch_session", Extra: map[string]any{
		"sessionPath": sessionPath,
	}}, 15*time.Second)
	if err != nil {
		return Snapshot{}, err
	}
	if resp == nil || !resp.Success {
		msg := "switch_session failed"
		if resp != nil && resp.Error != "" {
			msg = resp.Error
		}
		return Snapshot{}, fmt.Errorf("%s", msg)
	}
	var result struct {
		Cancelled bool `json:"cancelled"`
	}
	if err := json.Unmarshal(resp.Data, &result); err != nil {
		return Snapshot{}, fmt.Errorf("decode switch_session response: %w", err)
	}
	if result.Cancelled {
		return Snapshot{}, fmt.Errorf("session switch was cancelled")
	}
	// Pi rebuilds cwd-bound services from the target session header, so a
	// cross-workspace resume does not require restarting the Node process.
	if meta.Cwd != "" {
		a.mu.Lock()
		a.ws = meta.Cwd
		a.mu.Unlock()
	}
	return a.getSnapshot(false), nil
}

// DeleteSession removes a persisted Pi session. If it is currently active,
// switch to a fresh session first so Pi no longer owns the file being removed.
func (a *App) DeleteSession(sessionPath string) error {
	a.switchMu.Lock()
	defer a.switchMu.Unlock()

	target, err := a.deletableSessionPath(sessionPath)
	if err != nil {
		return err
	}
	if a.manager != nil && a.manager.IsRunning() {
		resp, err := a.manager.Request(pi.Command{Type: "get_state"}, 5*time.Second)
		if err != nil {
			return fmt.Errorf("get active session: %w", err)
		}
		if resp == nil || !resp.Success {
			return fmt.Errorf("get active session failed")
		}
		var state struct {
			SessionFile string `json:"sessionFile"`
		}
		if err := json.Unmarshal(resp.Data, &state); err != nil {
			return fmt.Errorf("decode active session: %w", err)
		}
		if state.SessionFile != "" && samePath(state.SessionFile, target) {
			resp, err := a.manager.Request(pi.Command{Type: "new_session"}, 15*time.Second)
			if err != nil {
				return fmt.Errorf("leave active session: %w", err)
			}
			if resp == nil || !resp.Success {
				return fmt.Errorf("leave active session failed")
			}
			var result struct {
				Cancelled bool `json:"cancelled"`
			}
			if err := json.Unmarshal(resp.Data, &result); err != nil {
				return fmt.Errorf("decode new_session response: %w", err)
			}
			if result.Cancelled {
				return fmt.Errorf("session deletion was cancelled")
			}
		}
	}
	if err := os.Remove(target); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

// deletableSessionPath accepts only real .jsonl files below Pi's sessions
// directory. Resolving symlinks prevents a linked file from escaping it.
func (a *App) deletableSessionPath(sessionPath string) (string, error) {
	if strings.TrimSpace(sessionPath) == "" {
		return "", fmt.Errorf("session path is empty")
	}
	target, err := filepath.Abs(sessionPath)
	if err != nil {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(target), ".jsonl") {
		return "", fmt.Errorf("session must be a .jsonl file")
	}
	if !fileExists(target) {
		return "", fmt.Errorf("session file not found: %s", target)
	}
	target, err = filepath.EvalSymlinks(target)
	if err != nil {
		return "", fmt.Errorf("resolve session path: %w", err)
	}

	allowedRoots := []string{
		filepath.Join(agentDirForCore(pi.CoreTypePi), "sessions"),
		filepath.Join(agentDirForCore(pi.CoreTypeOmp), "sessions"),
	}

	allowed := false
	for _, root := range allowedRoots {
		evalRoot, err := filepath.EvalSymlinks(root)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(evalRoot, target)
		if err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			allowed = true
			break
		}
	}

	if !allowed {
		return "", fmt.Errorf("session is outside the agent sessions directories")
	}
	return target, nil
}

// restartPiIn kills the pi subprocess (if any) and starts a fresh one in the
// given workspace. This is only needed when creating a fresh workspace session.
func (a *App) restartPiIn(workspace string) error {
	if a.manager != nil {
		if err := a.manager.StopAndWait(5 * time.Second); err != nil {
			return err
		}
	}
	if _, err := os.Stat(workspace); err != nil {
		return fmt.Errorf("workspace does not exist: %s", workspace)
	}
	return a.startPiLocked(workspace)
}

// agentDir returns the storage directory of the currently active core.
func (a *App) agentDir() string {
	a.mu.Lock()
	ct := a.coreType
	a.mu.Unlock()
	return agentDirForCore(ct)
}

// agentDirForCore returns ~/.omp/agent or ~/.pi/agent depending on the core.
func agentDirForCore(coreType string) string {
	ct := strings.ToLower(strings.TrimSpace(coreType))
	if ct == pi.CoreTypeOmp {
		if p := os.Getenv("OMP_AGENT_DIR"); p != "" {
			return p
		}
		if u, err := user.Current(); err == nil {
			return filepath.Join(u.HomeDir, ".omp", "agent")
		}
		return filepath.Join(os.Getenv("HOME"), ".omp", "agent")
	}
	if p := os.Getenv("PI_AGENT_DIR"); p != "" {
		return p
	}
	if u, err := user.Current(); err == nil {
		return filepath.Join(u.HomeDir, ".pi", "agent")
	}
	return filepath.Join(os.Getenv("HOME"), ".pi", "agent")
}

// piAgentDir returns ~/.pi/agent (backward-compatible).
func piAgentDir() string {
	return agentDirForCore(pi.CoreTypePi)
}

// OrdisSettings persists user-chosen engine configurations across restarts.
type OrdisSettings struct {
	CoreType string `json:"coreType"`
}

func ordisSettingsPath() string {
	if p := os.Getenv("ORDIS_SETTINGS_STORE"); p != "" {
		return p
	}
	return filepath.Join(ordisConfigDir(), "ordis-ai-settings.json")
}

func ordisConfigDir() string {
	if p := os.Getenv("ORDIS_CONFIG_DIR"); p != "" {
		return p
	}
	if u, err := user.Current(); err == nil {
		return filepath.Join(u.HomeDir, ".ordis-ai")
	}
	return filepath.Join(os.Getenv("HOME"), ".ordis-ai")
}

func readOrdisSettings() OrdisSettings {
	data, err := os.ReadFile(ordisSettingsPath())
	if err != nil {
		return OrdisSettings{CoreType: defaultCoreType()}
	}
	var s OrdisSettings
	if err := json.Unmarshal(data, &s); err != nil || (s.CoreType != pi.CoreTypePi && s.CoreType != pi.CoreTypeOmp) {
		return OrdisSettings{CoreType: defaultCoreType()}
	}
	return s
}

func writeOrdisSettings(s OrdisSettings) error {
	path := ordisSettingsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func defaultCoreType() string {
	if c := os.Getenv("ORDIS_AGENT_CORE"); c != "" {
		c = strings.ToLower(strings.TrimSpace(c))
		if c == pi.CoreTypeOmp || c == pi.CoreTypePi {
			return c
		}
	}
	return pi.CoreTypePi
}

// GetCoreType returns the currently active agent core ("pi" or "omp").
func (a *App) GetCoreType() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.coreType == "" {
		return pi.CoreTypePi
	}
	return a.coreType
}

// GetAvailableCores inspects the system and returns metadata for supported cores.
func (a *App) GetAvailableCores() []CoreInfo {
	cores := []struct {
		id   string
		name string
		desc string
	}{
		{
			id:   pi.CoreTypePi,
			name: "Pi (Coding Agent)",
			desc: "轻量级原生编码代理核心，支持基础文件读写与模型推理",
		},
		{
			id:   pi.CoreTypeOmp,
			name: "Oh My Pi (OMP)",
			desc: "增强型全能编码代理核心，支持多子代理并行任务、丰富工具链及扩展协议",
		},
	}
	out := make([]CoreInfo, 0, len(cores))
	for _, c := range cores {
		binPath, err := pi.FindCore(c.id)
		out = append(out, CoreInfo{
			ID:          c.id,
			Name:        c.name,
			Description: c.desc,
			Available:   err == nil && binPath != "",
			Path:        binPath,
			AgentDir:    agentDirForCore(c.id),
		})
	}
	return out
}

// SwitchCore switches the active agent core (e.g. "pi" or "omp"), restarts
// the subprocess in the current workspace, preserves active session context if any,
// and returns the refreshed snapshot.
func (a *App) SwitchCore(coreType string) (Snapshot, error) {
	a.switchMu.Lock()
	defer a.switchMu.Unlock()

	ct := strings.ToLower(strings.TrimSpace(coreType))
	if ct != pi.CoreTypePi && ct != pi.CoreTypeOmp {
		return Snapshot{}, fmt.Errorf("unsupported agent core: %s (supported: pi, omp)", coreType)
	}

	if _, err := pi.FindCore(ct); err != nil {
		return Snapshot{}, fmt.Errorf("agent core %q not available: %w", ct, err)
	}

	// If there's an active session open, preserve its path to resume in the new core
	var activeSessionPath string
	if a.manager != nil && a.manager.IsRunning() {
		if resp, err := a.manager.Request(pi.Command{Type: "get_state"}, 3*time.Second); err == nil && resp != nil && resp.Success {
			var state struct {
				SessionFile string `json:"sessionFile"`
			}
			if json.Unmarshal(resp.Data, &state) == nil && state.SessionFile != "" && fileExists(state.SessionFile) {
				activeSessionPath = state.SessionFile
			}
		}
	}

	// Persist the selected core type
	_ = writeOrdisSettings(OrdisSettings{CoreType: ct})

	a.mu.Lock()
	a.coreType = ct
	ws := a.ws
	a.mu.Unlock()

	if err := a.restartPiIn(ws); err != nil {
		return Snapshot{}, fmt.Errorf("switch core restart failed: %w", err)
	}

	// Re-attach active session to the newly started core
	if activeSessionPath != "" && a.manager != nil && a.manager.IsRunning() {
		_, _ = a.manager.Request(pi.Command{Type: "switch_session", Extra: map[string]any{
			"sessionPath": activeSessionPath,
		}}, 15*time.Second)
	}

	return a.getSnapshot(true), nil
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// sessionMeta is the minimal parsed info from a session file header.
type sessionMeta struct {
	ID           string
	Name         string
	Cwd          string
	MessageCount int
}

// readSessionMeta parses the first session line (type:"session") and
// counts message entries for a lightweight preview. The display name
// falls back to the first user message when no session name is stored.
func readSessionMeta(path string) sessionMeta {
	f, err := os.Open(path)
	if err != nil {
		return sessionMeta{}
	}
	defer f.Close()

	var meta sessionMeta
	var firstUserText string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	isFirst := true
	lines := 0
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		lines++
		if lines > 500 {
			break // preview only
		}
		if isFirst {
			isFirst = false
			var hdr struct {
				Type        string `json:"type"`
				ID          string `json:"id"`
				Cwd         string `json:"cwd"`
				SessionName string `json:"sessionName"`
				Name        string `json:"name"`
			}
			if json.Unmarshal(line, &hdr) == nil {
				meta.ID = hdr.ID
				meta.Cwd = hdr.Cwd
				meta.Name = hdr.Name
			}
			continue
		}
		var ent struct {
			Type    string `json:"type"`
			Message *struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(line, &ent) != nil {
			continue
		}
		if ent.Type == "message" {
			if meta.MessageCount == 0 && ent.Message != nil && ent.Message.Role == "user" && firstUserText == "" {
				firstUserText = extractText(ent.Message.Content)
			}
			meta.MessageCount++
		}
	}
	if meta.Name == "" && firstUserText != "" {
		meta.Name = truncateForDisplay(firstUserText, 40)
	}
	return meta
}

// extractText pulls the plain text out of a message content field which
// may be a string or an array of {type:"text", text} blocks.
func extractText(content json.RawMessage) string {
	if len(content) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(content, &s) == nil {
		return s
	}
	var blocks []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(content, &blocks) == nil {
		var sb strings.Builder
		for _, b := range blocks {
			if b.Text != "" {
				if sb.Len() > 0 {
					sb.WriteString(" ")
				}
				sb.WriteString(b.Text)
			}
		}
		return sb.String()
	}
	return ""
}

// truncateForDisplay shortens text for session list entries.
func truncateForDisplay(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// fileExists reports whether p exists and is not a directory.
func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// OpenWorkspace prompts for a directory and restarts pi inside it.
func (a *App) OpenWorkspace() (WorkspaceInfo, error) {
	dir, err := wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Open workspace",
	})
	if err != nil {
		return WorkspaceInfo{}, err
	}
	if dir == "" {
		return a.GetWorkspace(), nil // user cancelled
	}
	a.switchMu.Lock()
	defer a.switchMu.Unlock()
	if err := a.restartPiIn(dir); err != nil {
		return WorkspaceInfo{}, err
	}
	return a.GetWorkspace(), nil
}

// SendPrompt queues a user prompt to the agent.
func (a *App) SendPrompt(text string) error {
	if a.manager == nil || !a.manager.IsRunning() {
		return fmt.Errorf("pi is not running — start it first")
	}
	_, err := a.manager.Send(pi.Command{Type: "prompt", Message: text})
	return err
}

// Abort stops the current agent operation (Esc behavior).
func (a *App) Abort() error {
	if a.manager == nil || !a.manager.IsRunning() {
		return nil
	}
	_, err := a.manager.Send(pi.Command{Type: "clear_queue"})
	if err != nil {
		_, _ = a.manager.Send(pi.Command{Type: "abort"})
		return err
	}
	_, err = a.manager.Send(pi.Command{Type: "abort"})
	return err
}

// NewSession starts a fresh session in the running pi process.
func (a *App) NewSession() error {
	if a.manager == nil || !a.manager.IsRunning() {
		return fmt.Errorf("pi is not running")
	}
	_, err := a.manager.Send(pi.Command{Type: "new_session"})
	return err
}

// SetModel switches the active model.
func (a *App) SetModel(provider, modelID string) error {
	if a.manager == nil || !a.manager.IsRunning() {
		return fmt.Errorf("pi is not running")
	}
	_, err := a.manager.Send(pi.Command{Type: "set_model", Extra: map[string]any{
		"provider": provider,
		"modelId":  modelID,
	}})
	return err
}

// SetThinking sets the thinking level (off/minimal/low/medium/high/xhigh/max).
func (a *App) SetThinking(level string) error {
	if a.manager == nil || !a.manager.IsRunning() {
		return fmt.Errorf("pi is not running")
	}
	_, err := a.manager.Send(pi.Command{Type: "set_thinking_level", Extra: map[string]any{
		"level": level,
	}})
	return err
}

// SendDialogResponse answers an extension_ui_request (confirm/select/
// input/editor). Either value or cancelled must be provided.
func (a *App) SendDialogResponse(id string, value string, confirmed *bool, cancelled bool) error {
	if a.manager == nil || !a.manager.IsRunning() {
		return fmt.Errorf("pi is not running")
	}
	extra := map[string]any{"id": id}
	if value != "" {
		extra["value"] = value
	}
	if confirmed != nil {
		extra["confirmed"] = *confirmed
	}
	if cancelled {
		extra["cancelled"] = true
	}
	_, err := a.manager.Send(pi.Command{Type: "extension_ui_response", Extra: extra})
	return err
}

// shutdown is called by Wails when the window closes.
func (a *App) shutdown(ctx context.Context) {
	if a.manager != nil {
		a.manager.Close()
	}
}

// defaultWorkspace picks a sensible initial directory.
func defaultWorkspace() string {
	if cwd, err := os.Getwd(); err == nil {
		if _, err := os.Stat(cwd); err == nil {
			return cwd
		}
	}
	if u, err := user.Current(); err == nil {
		return u.HomeDir
	}
	return "."
}

// mergeEnvFallbacks re-applies environment variables that exist in the
// Windows registry (User/Machine scope) but are missing from the current
// process environment — e.g. when the app is launched from a shell whose
// environment predates the variable. Keys referenced by pi's models.json
// go first. PI_OFFLINE is left untouched: pi treats its presence as
// "disable network model refresh", and an explicit PI_OFFLINE=0 would
// disable network refreshing just the same.
func mergeEnvFallbacks() []string {
	var out []string
	keys := []string{
		"COMMANDCODE_API_KEY",
		"GPT_API_KEY",
		"OPENCODE_API_KEY",
		"ANTHROPIC_API_KEY",
		"OPENAI_API_KEY",
		"DEEPSEEK_API_KEY",
	}
	for _, k := range keys {
		if os.Getenv(k) != "" {
			continue
		}
		if v, ok := registryEnv(k); ok {
			out = append(out, k+"="+v)
		}
	}
	return out
}

// registryEnv reads a user- or machine-scoped environment variable from
// the Windows registry (no-op on non-Windows).
func registryEnv(name string) (string, bool) {
	if v, ok := readRegistry("HKCU", name); ok {
		return v, true
	}
	if v, ok := readRegistry("HKLM", name); ok {
		return v, true
	}
	return "", false
}

// readRegistry reads a Windows registry env value. Implemented in
// registry_windows.go / registry_other.go.
func readRegistry(scope, name string) (string, bool) {
	return readRegistryImpl(scope, name)
}

// Package pi wraps the `pi --mode rpc` subprocess: spawn, JSONL
// framing, request/response correlation and event streaming.
package pi

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Command is a single RPC command. Type is e.g. "prompt", "abort",
// "get_state", "set_model", "get_messages", "bash".
type Command struct {
	ID      string         `json:"id,omitempty"`
	Type    string         `json:"type"`
	Message string         `json:"message,omitempty"`
	Extra   map[string]any `json:"-"`
}

// MarshalJSON injects Extra fields at the top level, keeping the
// command's static fields authoritative.
func (c Command) MarshalJSON() ([]byte, error) {
	m := make(map[string]any, len(c.Extra)+4)
	for k, v := range c.Extra {
		m[k] = v
	}
	m["type"] = c.Type
	if c.ID != "" {
		m["id"] = c.ID
	}
	if c.Message != "" {
		m["message"] = c.Message
	}
	return json.Marshal(m)
}

// Response is the RPC response envelope.
type Response struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Command string          `json:"command"`
	Success bool            `json:"success"`
	Error   string          `json:"error,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// Event is a streamed event envelope. Data holds either the event
// payload (for typed events) or the raw event object (unknown types).
type Event struct {
	Type   string          `json:"type"`
	ID     string          `json:"id,omitempty"`
	Raw    json.RawMessage `json:"-"`
	Fields map[string]json.RawMessage
}

// Session meta information kept per spawned process.
type Session struct {
	PID       int    `json:"pid"`
	SessionID string `json:"sessionId,omitempty"`
}

// Manager owns the pi subprocess lifecycle and the pending request
// registry. It is safe for concurrent use.
type Manager struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	stdout   io.ReadCloser
	done     chan struct{}
	exiting  atomic.Bool
	nextID   atomic.Int64
	closed   bool
	onEvent  func(raw json.RawMessage, ev *Event)
	onExit   func(code int, signal string)
	onStderr func(line string)
	// Pending request resolution
	pending map[string]*pendingReq
}

type pendingReq struct {
	ch      chan *Response
	command string
	created time.Time
}

// NewManager creates a Manager. onEvent is called for every JSONL
// line parsed from stdout (responses are delivered through the pending
// channels and are also passed to onEvent as type "response").
func NewManager(onEvent func(raw json.RawMessage, ev *Event), onExit func(code int, signal string), onStderr func(line string)) *Manager {
	return &Manager{
		pending:  make(map[string]*pendingReq),
		onEvent:  onEvent,
		onExit:   onExit,
		onStderr: onStderr,
	}
}

// Start spawns `pi --mode rpc` with the provided extra args
// (e.g. --provider, --model, --session-dir). It returns once the
// process is running; events flow asynchronously.
func (m *Manager) Start(args []string, env []string) (*Session, error) {
	return m.StartIn("", args, env)
}

// StartIn is Start with an explicit working directory. If dir is empty
// the current process working directory is used.
func (m *Manager) StartIn(dir string, args []string, env []string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, fmt.Errorf("manager is closed")
	}
	if m.cmd != nil {
		return nil, fmt.Errorf("pi is already running")
	}

	piBin, err := findPi()
	if err != nil {
		return nil, err
	}
	inv, err := resolvePiCommand(piBin)
	if err != nil {
		return nil, err
	}

	cmdArgs := append([]string{"--mode", "rpc"}, args...)
	if inv.ViaCmd {
		// cmd.exe /c <shim> --mode rpc ...
		cmdArgs = append([]string{"/c", piBin}, cmdArgs...)
		inv.Executable = "cmd.exe"
	} else if len(inv.Args) > 0 {
		cmdArgs = append(inv.Args, cmdArgs...)
	}

	cmd := exec.Command(inv.Executable, cmdArgs...)
	cmd.Env = append(os.Environ(), env...)
	if dir != "" {
		cmd.Dir = dir
	}
	// Hide the child console window on Windows.
	setSysProcAttr(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start pi: %w", err)
	}

	m.cmd = cmd
	m.stdin = stdin
	m.stdout = stdout
	m.exiting.Store(false)

	go m.readLoop(stdout)
	go m.stderrLoop(stderr)
	done := make(chan struct{})
	m.done = done
	go m.waitLoop(cmd, done)

	return &Session{PID: cmd.Process.Pid}, nil
}

// IsRunning reports whether the subprocess is alive.
func (m *Manager) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cmd != nil && !m.exiting.Load()
}

// Send writes a command to pi's stdin. If id is empty a fresh id is
// generated and attached. Returns the id used.
func (m *Manager) Send(cmd Command) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.stdin == nil || m.exiting.Load() {
		return "", fmt.Errorf("pi is not running")
	}
	if cmd.ID == "" {
		cmd.ID = fmt.Sprintf("req-%d", m.nextID.Add(1))
	}
	line, err := json.Marshal(cmd)
	if err != nil {
		return "", fmt.Errorf("marshal command: %w", err)
	}
	if _, err := m.stdin.Write(append(line, '\n')); err != nil {
		return "", fmt.Errorf("write stdin: %w", err)
	}
	return cmd.ID, nil
}

// Request sends a command and waits for its response up to the timeout.
func (m *Manager) Request(cmd Command, timeout time.Duration) (*Response, error) {
	m.mu.Lock()
	if m.closed || m.stdin == nil || m.exiting.Load() {
		m.mu.Unlock()
		return nil, fmt.Errorf("pi is not running")
	}
	if cmd.ID == "" {
		cmd.ID = fmt.Sprintf("req-%d", m.nextID.Add(1))
	}
	line, err := json.Marshal(cmd)
	if err != nil {
		m.mu.Unlock()
		return nil, fmt.Errorf("marshal command: %w", err)
	}
	ch := make(chan *Response, 1)
	id := cmd.ID
	m.pending[id] = &pendingReq{ch: ch, command: cmd.Type, created: time.Now()}
	// Register the waiter before writing. Pi can answer simple commands so
	// quickly that writing first would let readLoop observe an unknown id.
	if _, err := m.stdin.Write(append(line, '\n')); err != nil {
		delete(m.pending, id)
		m.mu.Unlock()
		return nil, fmt.Errorf("write stdin: %w", err)
	}
	m.mu.Unlock()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case resp := <-ch:
		return resp, nil
	case <-timer.C:
		m.mu.Lock()
		delete(m.pending, id)
		m.mu.Unlock()
		return nil, fmt.Errorf("timeout waiting for %s response", cmd.Type)
	}
}

// StopAndWait kills the active subprocess and waits until waitLoop has
// finished clearing its handles. Callers can then safely restart the manager.
func (m *Manager) StopAndWait(timeout time.Duration) error {
	m.mu.Lock()
	if m.cmd == nil || m.cmd.Process == nil {
		m.mu.Unlock()
		return nil
	}
	done := m.done
	m.exiting.Store(true)
	_ = m.cmd.Process.Kill()
	m.mu.Unlock()

	if done == nil {
		return fmt.Errorf("pi exit waiter is unavailable")
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
		return nil
	case <-timer.C:
		return fmt.Errorf("pi process did not stop in time")
	}
}

// Abort kills the running pi process (used when the app quits).
func (m *Manager) Abort() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd != nil && m.cmd.Process != nil {
		_ = m.cmd.Process.Kill()
	}
}

// readLoop parses stdout as strict JSONL (LF only, tolerate CRLF).
func (m *Manager) readLoop(r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) > 0 && line[len(line)-1] == '\r' {
			line = line[:len(line)-1]
		}
		if len(line) == 0 {
			continue
		}
		m.handleLine(line)
	}
}

func (m *Manager) handleLine(line []byte) {
	// bufio.Scanner.Bytes() reuses its buffer on the next Scan, so the
	// slice we hand to json.Unmarshal (via json.RawMessage in Response.Data
	// and Event.Raw) would dangle the moment the following line arrives.
	// Copy first: responses are delivered through channels and consumed
	// after the scanner has already advanced.
	line = append([]byte(nil), line...)

	var raw json.RawMessage
	_ = json.Unmarshal(line, &raw)
	ev := &Event{}
	if err := json.Unmarshal(line, ev); err != nil {
		m.onStderr(fmt.Sprintf("[ordis] unparseable pi line: %s", string(line)))
		return
	}
	ev.Raw = raw

	if ev.Type == "response" {
		var resp Response
		if err := json.Unmarshal(line, &resp); err == nil {
			m.mu.Lock()
			req, ok := m.pending[resp.ID]
			if ok {
				delete(m.pending, resp.ID)
			}
			m.mu.Unlock()
			if ok {
				req.ch <- &resp
			}
		}
	}
	m.onEvent(raw, ev)
}

func (m *Manager) stderrLoop(r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		m.onStderr(scanner.Text())
	}
}

func (m *Manager) waitLoop(cmd *exec.Cmd, done chan struct{}) {
	defer close(done)
	err := cmd.Wait()
	m.exiting.Store(true)
	code := 0
	signal := ""
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			code = -1
		}
	}
	m.mu.Lock()
	for id, req := range m.pending {
		select {
		case req.ch <- &Response{ID: id, Command: req.command, Success: false, Error: "pi process exited"}:
		default:
		}
		delete(m.pending, id)
	}
	// Clear process handles so the manager can be restarted (the same
	// manager is reused across workspace switches).
	if m.cmd == cmd {
		m.cmd = nil
		m.stdin = nil
		m.stdout = nil
		m.exiting.Store(false)
	}
	m.mu.Unlock()
	if m.onExit != nil {
		m.onExit(code, signal)
	}
}

// Close tears the manager down for app shutdown.
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	if m.stdin != nil {
		_ = m.stdin.Close()
	}
	if m.cmd != nil && m.cmd.Process != nil {
		_ = m.cmd.Process.Kill()
	}
}

// findPi locates the pi executable: explicit env override, then PATH,
// then common install locations.
func findPi() (string, error) {
	if p := os.Getenv("ORDIS_PI_BIN"); p != "" {
		return p, nil
	}
	for _, name := range []string{"pi", "pi.cmd", "pi.exe", "pi.ps1"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}
	// npm global prefix fallback on Windows
	candidates := []string{
		os.Getenv("APPDATA") + `\npm\pi.cmd`,
		os.Getenv("NPM_GLOBAL") + `\pi.cmd`,
	}
	for _, c := range candidates {
		if c != "" && fileExists(c) {
			return c, nil
		}
	}
	return "", fmt.Errorf("pi executable not found on PATH; install with `npm i -g @earendil-works/pi-coding-agent` or set ORDIS_PI_BIN")
}

// piInvocation is a resolved spawn target: either a direct executable
// (pi.exe, node.exe with script) or a cmd wrapper that must run via
// cmd.exe /c.
type piInvocation struct {
	Executable string
	Args       []string
	// ViaCmd is true when Executable is a .cmd/.bat shim that only runs
	// under cmd.exe /c. Spawning it directly pops a console window.
	ViaCmd bool
}

// resolvePiCommand turns the pi shim into the cheapest spawn target.
// On Windows, `pi.cmd` inside npm's bin directory is:
//
//	@node.exe "%dp0%\..\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" %*
//
// We detect .cmd shims and read them to extract node + cli.js so we can
// spawn node directly with CREATE_NO_WINDOW — no cmd.exe, no console
// popup, no intermediate process.
func resolvePiCommand(piBin string) (piInvocation, error) {
	if !strings.EqualFold(filepath.Ext(piBin), ".cmd") {
		return piInvocation{Executable: piBin}, nil
	}
	content, err := os.ReadFile(piBin)
	if err == nil {
		if nodeExe, script, ok := parseCmdShim(string(content), piBin); ok {
			return piInvocation{Executable: nodeExe, Args: []string{script}}, nil
		}
	}
	// Fallback: run via cmd.exe /c (still hidden via CREATE_NO_WINDOW,
	// but an intermediate cmd exists).
	return piInvocation{Executable: piBin, ViaCmd: true}, nil
}

// parseCmdShim extracts `node <script>` from an npm cmd shim.
func parseCmdShim(content, shimPath string) (nodeExe, script string, ok bool) {
	// npm cmd shims use %dp0% (dir of the shim). The canonical target:
	//   "%_prog%"  "%dp0%\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" %*
	// Extract the cli.js fragment, resolve %dp0% against the shim dir.
	// NOTE: the package dir may itself contain backslashes (scoped
	// packages like @earendil-works\pi-coding-agent), so the middle
	// segment must allow any chars except % " and the leading slash.
	re := regexp.MustCompile(`(?i)"?%dp0%\\node_modules\\([^"%]+?)\\dist\\bundle\\([^"%\\]+\.js)"?`)
	m := re.FindStringSubmatch(content)
	if len(m) != 3 {
		return "", "", false
	}
	dir := filepath.Dir(shimPath)
	pkgPath := filepath.FromSlash(strings.ReplaceAll(m[1], "\\", "/"))
	script = filepath.Join(dir, "node_modules", pkgPath, "dist", "bundle", m[2])
	// node executable: prefer the shim dir's node.exe, else PATH node.
	nodeCandidates := []string{filepath.Join(dir, "node.exe")}
	if p, err := exec.LookPath("node.exe"); err == nil {
		nodeCandidates = append(nodeCandidates, p)
	}
	if p, err := exec.LookPath("node"); err == nil {
		nodeCandidates = append(nodeCandidates, p)
	}
	for _, c := range nodeCandidates {
		if fileExists(c) {
			return c, script, fileExists(script)
		}
	}
	return "", "", false
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

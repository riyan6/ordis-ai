package pi

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

type checkingWriteCloser struct {
	write func([]byte) (int, error)
}

func (w checkingWriteCloser) Write(p []byte) (int, error) { return w.write(p) }
func (checkingWriteCloser) Close() error                  { return nil }

func TestRequestRegistersPendingBeforeWrite(t *testing.T) {
	m := NewManager(func(json.RawMessage, *Event) {}, nil, func(string) {})
	m.stdin = checkingWriteCloser{write: func(line []byte) (int, error) {
		var command Command
		if err := json.Unmarshal(line, &command); err != nil {
			t.Fatalf("decode command: %v", err)
		}
		if _, ok := m.pending[command.ID]; !ok {
			t.Fatal("request was written before its pending waiter was registered")
		}
		response, err := json.Marshal(Response{
			ID:      command.ID,
			Type:    "response",
			Command: command.Type,
			Success: true,
		})
		if err != nil {
			t.Fatalf("encode response: %v", err)
		}
		go m.handleLine(response)
		return len(line), nil
	}}

	resp, err := m.Request(Command{Type: "get_state"}, time.Second)
	if err != nil {
		t.Fatalf("Request: %v", err)
	}
	if resp == nil || !resp.Success {
		t.Fatalf("unexpected response: %#v", resp)
	}
}

// TestPiSpawnAndState verifies we can spawn pi --mode rpc and talk to it.
func TestPiSpawnAndState(t *testing.T) {
	piBin := os.Getenv("ORDIS_PI_BIN")
	if piBin == "" {
		t.Skip("ORDIS_PI_BIN not set; run this test with pi on PATH")
	}

	var gotState json.RawMessage
	var gotModel json.RawMessage
	events := 0

	m := NewManager(
		func(raw json.RawMessage, ev *Event) {},
		func(code int, signal string) { t.Logf("exit code=%d", code) },
		func(line string) { t.Logf("stderr: %s", line) },
	)
	defer m.Close()

	if _, err := m.Start([]string{"--no-session"}, nil); err != nil {
		t.Fatalf("start: %v", err)
	}
	time.Sleep(1500 * time.Millisecond)

	resp, err := m.Request(Command{Type: "get_state"}, 10*time.Second)
	if err != nil {
		t.Fatalf("get_state: %v", err)
	}
	t.Logf("get_state: success=%v data=%s", resp.Success, string(resp.Data))

	resp, err = m.Request(Command{Type: "get_available_models"}, 10*time.Second)
	if err != nil {
		t.Fatalf("models: %v", err)
	}
	gotModel = resp.Data
	modelsStr := string(gotModel)
	if len(modelsStr) > 600 {
		modelsStr = modelsStr[:600]
	}
	t.Logf("models: %s", modelsStr)

	_ = events
	_ = gotState
}
func TestFindCore(t *testing.T) {
	fakePi := "/custom/bin/fake-pi"
	fakeOmp := "/custom/bin/fake-omp"
	t.Setenv("ORDIS_PI_BIN", fakePi)
	t.Setenv("ORDIS_OMP_BIN", fakeOmp)

	p, err := FindCore(CoreTypePi)
	if err != nil || p != fakePi {
		t.Fatalf("FindCore(pi) = (%q, %v), want %q", p, err, fakePi)
	}

	o, err := FindCore(CoreTypeOmp)
	if err != nil || o != fakeOmp {
		t.Fatalf("FindCore(omp) = (%q, %v), want %q", o, err, fakeOmp)
	}
}

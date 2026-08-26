package pi

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

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

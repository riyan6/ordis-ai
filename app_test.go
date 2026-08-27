package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ordis-ai/pkg/pi"
)

func mkTestApp() *App {
	app := NewApp()
	// Do NOT call startup(context.Background()): EventsEmit requires the
	// specific context handed out by the Wails lifecycle hooks. With ctx
	// nil, event forwarding is skipped (events are dropped) while the
	// request/response path under test works unchanged.
	app.mu.Lock()
	app.ws = defaultWorkspace()
	app.mu.Unlock()
	app.manager = pi.NewManager(app.onPiEvent, app.onPiExit, func(line string) {
		fmt.Printf("[pi-stderr] %s\n", line)
	})
	return app
}

func TestStartPiGetState(t *testing.T) {
	app := mkTestApp()
	// Ensure env var exists for auth
	if os.Getenv("COMMANDCODE_API_KEY") == "" {
		t.Skip("COMMANDCODE_API_KEY not in environment")
	}
	if err := app.StartPi(); err != nil {
		t.Fatalf("StartPi: %v", err)
	}
	defer app.StopPi()
	time.Sleep(2500 * time.Millisecond)

	// 关键实验:在 get_state 之前先请求一次模型(触发快照填充)
	preResp, preErr := app.manager.Request(pi.Command{Type: "get_available_models"}, 10*time.Second)
	if preErr != nil {
		t.Logf("pre models err: %v", preErr)
	} else {
		t.Logf("PRE get_available_models: %s", truncateJSON(string(preResp.Data), 300))
	}

	resp, err := app.manager.Request(pi.Command{Type: "get_state"}, 10*time.Second)
	if err != nil {
		t.Fatalf("get_state: %v", err)
	}
	t.Logf("state: success=%v data=%s", resp.Success, string(resp.Data))

	// Models: poll with proper decode until non-empty.
	deadline := time.Now().Add(8 * time.Second)
	for i := 0; ; i++ {
		resp, err = app.manager.Request(pi.Command{Type: "get_available_models"}, 10*time.Second)
		if err != nil {
			t.Fatalf("models: %v", err)
		}
		t.Logf("poll[%d] raw: %s", i, truncateJSON(string(resp.Data), 200))
		if i == 0 {
			t.Logf("poll[0] resp.Data type: %T", resp.Data)
		}
		var mods struct {
			Models []struct {
				ID       string `json:"id"`
				Name     string `json:"name"`
				Provider string `json:"provider"`
			} `json:"models"`
		}
		if err := json.Unmarshal(resp.Data, &mods); err != nil {
			t.Fatalf("unmarshal models: %v", err)
		}
		t.Logf("poll[%d] unmarshal count: %d", i, len(mods.Models))
		if len(mods.Models) > 0 {
			t.Logf("models found: %d (sample: %s/%s)", len(mods.Models), mods.Models[0].Provider, mods.Models[0].ID)
			break
		}
		if time.Now().After(deadline) || i > 4 {
			t.Errorf("expected at least one available model")
			break
		}
		time.Sleep(1 * time.Second)
	}
}

func TestDeleteSessionOnlyAllowsPiSessionFiles(t *testing.T) {
	agentDir := t.TempDir()
	t.Setenv("PI_AGENT_DIR", agentDir)
	sessionsDir := filepath.Join(agentDir, "sessions", "project")
	if err := os.MkdirAll(sessionsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(sessionsDir, "session.jsonl")
	if err := os.WriteFile(target, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	if err := app.DeleteSession(target); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("session still exists: %v", err)
	}

	outside := filepath.Join(t.TempDir(), "outside.jsonl")
	if err := os.WriteFile(outside, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := app.DeleteSession(outside); err == nil {
		t.Fatal("expected an error for a session outside the Pi sessions directory")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("outside file was modified: %v", err)
	}
}

func truncateJSON(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

var _ = strings.TrimSpace

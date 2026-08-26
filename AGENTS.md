# AGENTS.md — ordis-ai

面向 AI 编码代理的项目指南。ordis-ai 是一个 **Wails v2 (Go + WebView2) 桌面 GUI**，作为 [Pi](https://pi.dev) 编码代理的原生前端：它不实现 agent，只通过 `pi --mode rpc` 的 JSONL 协议驱动本机已安装的 pi CLI。

## 项目概况

- **界面语言**：界面文案为用户可见文本，使用中文；代码注释/日志/文档用英文；结构体/字段/事件名遵循项目已有命名。
- **目标平台**：仅 Windows（当前环境）；代码保留了 `runtime.GOOS` 分支，但不要为其他平台引入未验证的路径。
- **两个子项目边界不可混淆**：
  - `ordis-ai`（本仓库，Wails 桌面应用）
  - `pi-ordis`（`WebstormProjects\pi-ordis`，Web 版，**仅作参考，不要修改**）

## 架构

```text
Desktop Window (WebView2, React 18 + Vite 6 + TS)
   │  Wails bindings (Promise)  +  runtime.EventsEmit 事件 (pi:event/pi:exit/pi:stderr)
   ▼
Go 后端 (app.go — Wails App 绑定层; pkg/pi/pi.go — Pi RPC 进程管理)
   │  spawn `node cli.js --mode rpc` + JSONL framing + pending-map 请求/响应
   ▼
pi --mode rpc   (用户本机安装的 pi CLI，路径 ~/.pi/agent 下读取 models/auth)
```

### 关键文件

| 文件 | 职责 |
|---|---|
| `main.go` | Wails 入口，窗口尺寸/OnStartup/OnShutdown/Bind |
| `app.go` | 所有 Wails 绑定方法（StartPi/SendPrompt/ResumeSession/SwitchWorkspace/ListWorkspaces…）、事件桥、workspace/session 注册表 |
| `pkg/pi/pi.go` | pi 子进程管理：spawn、JSONL 读写、请求/响应关联、shim 解析、退出清理 |
| `pkg/pi/resolve_test.go` | `pi.cmd` shim → `node cli.js` 解析测试 |
| `pkg/pi/pi_test.go` | spawn + get_state 冒烟测试（需要 `ORDIS_PI_BIN`/key） |
| `registry_windows.go` / `registry_other.go` | Windows 注册表环境变量回退（按 build tag 分平台） |
| `frontend/src/use-pi-session.ts` | **前端唯一状态核心**：事件流折叠、消息去重、switching/加载态、workspace 操作 |
| `frontend/src/App.tsx` | dsh 风格布局：Aside(工作区树) + Header + Main(聊天/输入) |
| `frontend/src/pi-types.ts` | Pi RPC 协议的 TS 类型（仅声明，勿改字段名） |
| `frontend/src/components/Message.tsx` | 消息渲染（markdown/思考块/工具卡片） |
| `frontend/wailsjs/` | **自动生成，禁止手改**（`wails generate module` 刷新） |

## 构建与验证

```bash
# 前端（必须在 frontend 目录）
cd frontend && npm install && npm run build

# 后端 + 全量测试（端到端测试需 COMMANDCODE_API_KEY）
go build ./...
go test ./...        # 需要 $env:COMMANDCODE_API_KEY；否则部分测试 SKIP

# Wails 绑定再生成（改了 Go 导出方法后必做，否则前端 import 失败）
wails generate module

# 生产构建（自动跑 frontend:install + frontend:build）
wails build          # 产物 build/bin/ordis-ai.exe
```

- **改 Go 导出方法后必须**：`wails generate module`（同步 `frontend/wailsjs/`）。
- **验证必须跑**：`go vet ./...` + `go test ./...` + `npm run build`（tsc 严格检查）。
- 端到端测试（`app_test.go`）会真实 spawn pi；无 key 时自动 SKIP，不要删掉这些测试。

## 关键陷阱（踩坑记录！务必遵守）

### 1. `pi:event` 载荷必须是 JSON 对象，不能是 `[]byte`
`onPiEvent` 收到 `json.RawMessage`（`[]byte`）时，**先 `json.Unmarshal` 成 `any` 再 `EventsEmit`**。直接传 `[]byte` 会被 Wails 序列化成 **Base64 字符串**，前端 `JSON.parse` 失败 → 所有事件静默丢失（表现为：无流式、无思考、停止按钮不出现）。`app.go` 内已有注释说明，勿"简化"掉。

### 2. `bufio.Scanner.Bytes()` 缓冲区复用
`pkg/pi/pi.go` 的 `handleLine` 必须对 `line` 做 `append([]byte(nil), line...)` 拷贝。`Response.Data` 是 `json.RawMessage`，指向 scanner 缓冲区，下一次 `Scan` 会覆盖它 → 响应内容损坏。已修复，加代码时不要引入新的"零拷贝"写法。

### 3. `resp.Data` 就是 `data` 字段载荷
pi RPC 响应 `{id, type:"response", success, data}` 中，`Manager.Request` 返回的 `resp.Data` **已经解包到 `data`**。解析时直接 `json.Unmarshal(resp.Data, &payload)`，**不要再套一层 `{data: ...}` 结构**（`json.Unmarshal` 对未知 key 静默跳过，返回空但零报错——这是最隐蔽的 bug）。

### 4. 事件流消息生命周期（前端）
pi 会为同一条消息发 `message_start` + `message_end`，assistant 还有 `message_update` 增量：
- `message_start`(assistant)：**不要创建空消息**（会闪烁），由首个 `message_update` 延迟创建流式槽位
- `message_start`(user)：只消费（去重逻辑比对最后一条 user 文本，允许相同文本的连续消息）
- `message_end`(assistant)：替换 stream 槽位为权威内容
- `agent_end`：**只替换最后一个 assistant 消息**，不要全量重建（会丢掉中间思考/工具槽位）
- `thinking_start` 单独到达时跳过（避免空思考框闪现），`thinking_delta` 才建块

### 5. 工作区注册表
- 真实数据在 `~/.pi/agent/ordis-ai-workspaces.json`。
- **测试必须隔离**：`ORDIS_WS_STORE` 环境变量（`workspaceStorePath()` 读取），否则会污染用户注册表（曾发生过：测试把 Temp 目录写进真实列表）。
- `ListWorkspaces`：路径**归一化去重**（`samePath`/`normalizePath`，大小写/尾部斜杠） + **过滤已不存在的目录**。
- **不要再在 Go 测试里调用会写真实路径的方法**（AddWorkspace/SwitchWorkspace 等），除非先设 `ORDIS_WS_STORE`。

### 6. 前端 CSS 覆盖
`frontend/src/App.css` 保留为空文件（模板残留的 `.app` 规则曾覆盖 `style.css` 的 row 布局，导致侧边栏堆叠）。**不要在 App.css 里加布局规则**，全部写在 `style.css`。

### 7. pi 进程生命周期
- `Manager` 复用：`waitLoop` 退出后清理 `cmd/stdin/stdout`，同一 Manager 可再次 `StartIn`（工作区切换依赖此行为）。
- `restartPiIn`：`Abort()` 后**必须轮询 `IsRunning()` 等进程真正退出**，再 `startPiLocked`，否则"pi is already running"。
- 切工作区时前端用 `switchingRef` 忽略预期的 `pi:exit`（否则 `running=false` 闪启动页）。

### 8. Windows 细节
- spawn `pi.cmd` 会弹控制台：必须经 `resolvePiCommand` 解析成 `node cli.js` 直连，并设置 `CREATE_NO_WINDOW`（`HideWindow`）。
- `wailsruntime` 别名导入（`runtime` 与标准库重名）。
- Windows 注册表环境变量：`COMMANDCODE_API_KEY` 等按 User/Machine 级读取 (`registry_windows.go`)。

## 约定

- **Go**：单一 `App` 结构持有 `manager`/`ws`；`mu` 保护跨 goroutine 状态；Wails 绑定方法命名 PascalCase 导出。
- **前端**：所有状态集中在 `usePiSession` hook（App.tsx 不直接调 Wails 绑定）；事件处理函数用 `useCallback` 包裹。
- **消息结构**：`UiMessage.id` 用 `nextId()` 生成；流式槽位 `streamRef.current` 与 `messages` 里的 `streaming: true` 项一一对应。
- **会话/工作区数据**：SessionInfo 的 `Workspace` 是 session 文件内的 `cwd`；一个"新会话"挂在 pi 进程当前 cwd 下（切工作区 = 重启 pi 到该目录）。
- **提交代码前**：不要修改 `wailsjs/` 生成物、不要改 `pi-types.ts` 已有字段、不要动 `App.css`。

## 参考文档

- Pi RPC 协议：`pi.dev/docs/latest/rpc`（或本地 `node_modules\@earendil-works\pi-coding-agent\docs\rpc.md`）
- Wails：https://wails.io/docs/reference/project-config
- 参考实现（勿改）：`C:\Users\riyan6\WebstormProjects\pi-ordis`（pi 的 Web UI）

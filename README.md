# ordis-ai — Pi 桌面 GUI

基于 **Wails v2 (Go + WebView2)** 的 [Pi](https://pi.dev) 编码代理桌面客户端。

- 原生 Windows 窗口（无 Electron 开销，安装包 ~15MB）
- 通过 `pi --mode rpc` 的 JSONL 协议与你的本地 Pi 通信（不重复实现 agent，Pi 仍是唯一代理）
- 流式对话：文本 / 思考过程折叠块 / 工具调用卡片 / bash 输出
- 模型与思考级别切换、会话管理、扩展 UI 对话框（confirm / select / input / editor）
- 工作区选择（Open Workspace 或从当前目录启动）
- 凭据从注册表回退读取（`COMMANDCODE_API_KEY` 等机器级环境变量）

## 架构

```text
Desktop Window (WebView2, React + Vite + TS)
   │  Wails bindings (Promise) + runtime.EventsEmit (JSONL events)
   ▼
Go 后端 (app.go, pkg/pi)
   │  spawn + JSONL framing (LF only, 拷贝缓冲, pending-map request/response)
   ▼
pi --mode rpc  (你已安装的 pi CLI)
```

## 开发

```bash
# 前端依赖 + 绑定生成（wails generate module 会同步生成 wailsjs/）
cd frontend && npm install

# 热重载开发（wails dev 自动启动 Vite + 编译 Go）
wails dev

# 测试（可选:设置 COMMANDCODE_API_KEY 以跑端到端模型测试）
go test ./...

# 生产构建
wails build
```

## 使用

1. 运行 `ordis-ai.exe`（构建产物在 `build/bin/`）
2. 点击 **启动 Pi Agent** —— 后端在该项目目录 spawn `pi --mode rpc --approve`
3. 输入消息，Pi 流式回复；右上角切换模型/思考级别；Esc 或"停止"中断
4. `new` 开启新会话，`restart` 重启 Pi 进程，顶部标题栏显示当前工作区

## 配置

- 模型与提供商读取 `~/.pi/agent/models.json`（和 pi CLI 一致）
- 若模型列表为空：确认 `~/.pi/agent/auth.json` 有登录凭据、或
  `COMMANDCODE_API_KEY` 等环境变量在注册表 User/Machine 级存在
  （后端会自动回退读取）
- 覆盖可执行文件路径：`ORDIS_PI_BIN` 环境变量

## 目录结构

```text
app.go            Wails 绑定 + Pi 事件桥（GetSnapshot/SendPrompt/Abort/...）
main.go           应用入口
pkg/pi/           Pi RPC 进程管理（spawn、JSONL、请求/响应、退出清理）
registry_*.go     Windows 注册表环境变量回退
frontend/src/     React UI（use-pi-session.ts 是会话状态核心）
```

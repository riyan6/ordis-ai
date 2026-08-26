/**
 * ordis-ai desktop GUI — modern white-theme workbench for the Pi coding agent.
 * Designed with Tether & Linear-inspired desktop craftsmanship.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePiSession, type SessionInfo, type WorkspaceRecord } from "./use-pi-session";
import { Message } from "./components/Message";
import {
	Plus,
	Folder,
	ChevronDown,
	ChevronRight,
	ArrowRight,
	ArrowUp,
	Square,
	RotateCw,
	Sparkles,
	Brain,
	Cpu,
	MessageSquare,
	PanelLeftClose,
	PanelLeft,
	FolderPlus,
	ShieldCheck,
	Code,
	FileSearch,
	CheckCircle2,
	AlertCircle,
	Terminal
} from "lucide-react";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export default function App() {
	const {
		running,
		starting,
		messages,
		tools,
		state,
		models,
		workspace,
		workspacePath,
		lastError,
		dialog,
		agentBusy,
		sessions,
		workspaces,
		currentWorkspace,
		switching,
		start,
		stop,
		send,
		abort,
		newSession,
		loadSessions,
		loadWorkspaces,
		resume,
		switchWorkspace,
		addWorkspace,
		switchModel,
		changeThinking,
		answerDialog,
	} = usePiSession();

	const [input, setInput] = useState("");
	const [modelOpen, setModelOpen] = useState(false);
	const [thinkingOpen, setThinkingOpen] = useState(false);
	const [asideCollapsed, setAsideCollapsed] = useState(false);
	const [expandedWs, setExpandedWs] = useState<string>(currentWorkspace || "");

	useEffect(() => {
		if (currentWorkspace && !expandedWs) setExpandedWs(currentWorkspace);
	}, [currentWorkspace, expandedWs]);

	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const modelMenuRef = useRef<HTMLDivElement>(null);
	const thinkingMenuRef = useRef<HTMLDivElement>(null);

	// Close dropdowns on outside click
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
				setModelOpen(false);
			}
			if (thinkingMenuRef.current && !thinkingMenuRef.current.contains(event.target as Node)) {
				setThinkingOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Auto-scroll on new content
	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 250;
		if (nearBottom) el.scrollTop = el.scrollHeight;
	}, [messages, tools]);

	useEffect(() => {
		inputRef.current?.focus();
	}, [running]);

	const onSubmit = useCallback(() => {
		if (!running || !input.trim()) return;
		void send(input);
		setInput("");
		if (inputRef.current) {
			inputRef.current.style.height = "auto";
		}
	}, [running, input, send]);

	const onKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
				e.preventDefault();
				onSubmit();
			}
		},
		[onSubmit],
	);

	const handleQuickPrompt = (promptText: string) => {
		void send(promptText);
	};

	const currentModel = state?.model;
	const currentThinkingLevel = state?.thinkingLevel ?? "off";
	const currentSessionTitle =
		state?.sessionName ||
		messages
			.find((m) => m.role === "user")
			?.content?.map((b) => (b.type === "text" ? b.text : ""))
			.filter(Boolean)
			.join(" ")
			.slice(0, 50) ||
		"新会话";

	const timeAgo = (ts: number) => {
		const diff = Date.now() - ts;
		const m = Math.floor(diff / 60000);
		if (m < 1) return "刚刚";
		if (m < 60) return `${m} 分钟前`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} 小时前`;
		const d = Math.floor(h / 24);
		return `${d} 天前`;
	};

	const workspaceName = (p: string) => {
		const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
		return parts[parts.length - 1] || p || "未命名";
	};

	const onWsToggle = (path: string) => {
		setExpandedWs((prev) => (prev === path ? "" : path));
	};

	return (
		<div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 select-none">
			{/* ===== Aside (Left Rail) ===== */}
			<aside
				className={`flex flex-col bg-slate-100/75 border-r border-slate-200/90 transition-all duration-200 z-20 ${
					asideCollapsed ? "w-[56px]" : "w-[264px]"
				}`}
			>
				{/* Aside Header */}
				<div className="flex items-center justify-between px-3.5 py-3 h-12 border-b border-slate-200/70">
					<div className="flex items-center gap-2 min-w-0">
						<div className="w-6 h-6 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-xs shadow-xs flex-shrink-0">
							π
						</div>
						{!asideCollapsed && (
							<span className="font-semibold text-[13.5px] tracking-tight text-slate-800 truncate">
								ordis-ai
							</span>
						)}
					</div>
					<button
						onClick={() => setAsideCollapsed(!asideCollapsed)}
						className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors"
						title={asideCollapsed ? "展开侧边栏" : "折叠侧边栏"}
					>
						{asideCollapsed ? (
							<PanelLeft className="w-4 h-4" />
						) : (
							<PanelLeftClose className="w-4 h-4" />
						)}
					</button>
				</div>

				{/* Aside Content */}
				{!asideCollapsed ? (
					<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
						{/* New Chat Button */}
						<div className="p-3 pb-1">
							<button
								onClick={() => void newSession()}
								className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-xl border border-slate-200/90 shadow-xs hover:border-slate-300 transition-all group"
							>
								<Plus className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-800" />
								<span>新会话</span>
							</button>
						</div>

						{/* Workspaces & Sessions Tree */}
						<div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-4">
							<div>
								<div className="flex items-center justify-between px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-slate-600 uppercase">
									<span>工作区</span>
									<button
										onClick={() => void addWorkspace()}
										className="p-0.5 rounded hover:bg-slate-200/70 text-slate-600 hover:text-slate-900 transition-colors"
										title="添加工作区（选择文件夹）"
									>
										<FolderPlus className="w-3.5 h-3.5" />
									</button>
								</div>

								{workspaces.length === 0 && (
									<div className="text-xs text-slate-400 italic px-2 py-2">
										正在加载工作区…
									</div>
								)}

								<div className="space-y-1 mt-1">
									{workspaces.map((w) => {
										const isActive = w.path === currentWorkspace;
										const isExpanded = expandedWs === w.path;
										const wsSess = sessions.filter((s) => s.workspace === w.path);

										return (
											<div key={w.id} className="space-y-0.5">
												{/* Workspace Header Row */}
												<div
													onClick={() => onWsToggle(w.path)}
													className={`group flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
														isActive
															? "bg-white text-slate-900 shadow-2xs border border-slate-200/80"
															: "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900"
													}`}
													title={w.path}
												>
													<div className="flex items-center gap-1.5 min-w-0 flex-1">
														{isExpanded ? (
															<ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />
														) : (
															<ChevronRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
														)}
														<Folder className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
														<span className="truncate">{w.name}</span>
													</div>

													<div className="flex items-center gap-1">
														{isActive ? (
															<span
																className="w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-100"
																title="当前活动工作区"
															/>
														) : (
															<button
																onClick={(e) => {
																	e.stopPropagation();
																	void switchWorkspace(w.path);
																}}
																className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-all"
																title={`切换工作区至 ${w.name}`}
															>
																<ArrowRight className="w-3 h-3" />
															</button>
														)}
													</div>
												</div>

												{/* Sessions under this Workspace */}
												{isExpanded && (
													<div className="pl-4 pr-1 py-0.5 space-y-0.5 border-l border-slate-200 ml-3.5">
														{wsSess.slice(0, 15).map((s) => {
															const isCurrentSession = state?.sessionId === s.id;
															return (
																<button
																	key={s.id}
																	onClick={() => void resume(s)}
																	className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[11.5px] text-left transition-all ${
																		isCurrentSession
																			? "bg-slate-200/80 font-medium text-slate-900"
																			: "text-slate-500 hover:bg-slate-200/50 hover:text-slate-800"
																	}`}
																	title={s.name || s.id}
																>
																	<span className="truncate flex-1 pr-2">
																		{s.name || "未命名会话"}
																	</span>
																	<span className="text-[10px] text-slate-400 flex-shrink-0">
																		{timeAgo(s.updatedAt)}
																	</span>
																</button>
															);
														})}

														{wsSess.length === 0 && (
															<div className="text-[11px] text-slate-400 italic px-2 py-1">
																暂无历史会话
															</div>
														)}
													</div>
												)}
											</div>
										);
									})}
								</div>
							</div>
						</div>

						{/* Aside Footer (Pi Process Status) */}
						<div className="p-3 border-t border-slate-200/70 bg-slate-100/40 text-xs text-slate-500 flex items-center justify-between">
							<div className="flex items-center gap-1.5 min-w-0">
								<span
									className={`w-2 h-2 rounded-full flex-shrink-0 ${
										agentBusy
											? "bg-amber-500 animate-pulse"
											: running
											? "bg-emerald-500"
											: "bg-rose-500"
									}`}
								/>
								<span className="truncate text-[11.5px]">
									{agentBusy ? "Pi 正在运行" : running ? "Pi 就绪" : "Pi 已停止"}
								</span>
							</div>
							<button
								onClick={() => void stop()}
								className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
								title="重启 Pi 进程"
							>
								<RotateCw className="w-3.5 h-3.5" />
							</button>
						</div>
					</div>
				) : (
					/* Collapsed Rail Icons */
					<div className="flex-1 flex flex-col items-center py-3 gap-2">
						<button
							onClick={() => void newSession()}
							className="w-8 h-8 rounded-lg bg-white border border-slate-200 shadow-2xs flex items-center justify-center text-slate-700 hover:bg-slate-50"
							title="新会话"
						>
							<Plus className="w-4 h-4" />
						</button>
						<button
							onClick={() => void addWorkspace()}
							className="w-8 h-8 rounded-lg hover:bg-slate-200/70 flex items-center justify-center text-slate-500 hover:text-slate-800"
							title="添加工作区"
						>
							<FolderPlus className="w-4 h-4" />
						</button>
					</div>
				)}
			</aside>

			{/* ===== Main Pane ===== */}
			<div className="flex-1 flex flex-col min-w-0 h-full bg-white relative">
				{/* Top Navigation Bar */}
				<header className="h-12 border-b border-slate-200/80 bg-white px-4 flex items-center justify-between flex-shrink-0 z-10 select-none">
					{/* Left: Active Title & Workspace */}
					<div className="flex items-center gap-2 min-w-0 flex-1">
						<span className="font-semibold text-xs text-slate-800 truncate max-w-sm">
							{currentSessionTitle}
						</span>
						{currentWorkspace && (
							<span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-mono border border-slate-200/80">
								<Folder className="w-3 h-3 text-slate-400" />
								{workspaceName(currentWorkspace)}
							</span>
						)}
					</div>

					{/* Right: Model Picker, Thinking Picker, Status Action */}
					<div className="flex items-center gap-2 flex-shrink-0">
						{/* Model Picker Pill */}
						{models.length > 0 && (
							<div className="relative" ref={modelMenuRef}>
								<button
									onClick={() => setModelOpen(!modelOpen)}
									className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700 transition-colors"
								>
									<Cpu className="w-3.5 h-3.5 text-slate-500" />
									<span className="truncate max-w-[130px]">
										{currentModel?.name ?? currentModel?.id ?? "选择模型"}
									</span>
									<ChevronDown className="w-3 h-3 text-slate-400" />
								</button>

								{modelOpen && (
									<div className="absolute right-0 mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 z-50 max-h-80 overflow-y-auto">
										<div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
											切换模型
										</div>
										{models.map((m) => (
											<button
												key={m.id}
												onClick={() => {
													void switchModel(m.id);
													setModelOpen(false);
												}}
												className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex flex-col transition-colors ${
													currentModel?.id === m.id
														? "bg-slate-100 font-medium text-slate-900"
														: "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
												}`}
											>
												<span className="font-medium">{m.name}</span>
												<span className="text-[10.5px] text-slate-400 font-mono">
													{m.provider}
												</span>
											</button>
										))}
									</div>
								)}
							</div>
						)}

						{/* Thinking Level Picker Pill */}
						{state && (
							<div className="relative" ref={thinkingMenuRef}>
								<button
									onClick={() => setThinkingOpen(!thinkingOpen)}
									className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700 transition-colors"
								>
									<Brain className="w-3.5 h-3.5 text-slate-500" />
									<span>思考: {currentThinkingLevel}</span>
									<ChevronDown className="w-3 h-3 text-slate-400" />
								</button>

								{thinkingOpen && (
									<div className="absolute right-0 mt-1.5 w-36 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-50">
										<div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
											思考等级
										</div>
										{THINKING_LEVELS.map((lvl) => (
											<button
												key={lvl}
												onClick={() => {
													void changeThinking(lvl);
													setThinkingOpen(false);
												}}
												className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
													currentThinkingLevel === lvl
														? "bg-slate-100 font-medium text-slate-900"
														: "text-slate-600 hover:bg-slate-50"
												}`}
											>
												{lvl}
											</button>
										))}
									</div>
								)}
							</div>
						)}

						{/* Abort / Restart Status Button */}
						{agentBusy ? (
							<button
								onClick={() => void abort()}
								className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-medium transition-colors"
								title="中断当前操作 (Esc)"
							>
								<Square className="w-3 h-3 fill-rose-500 text-rose-500" />
								<span>停止</span>
							</button>
						) : (
							<button
								onClick={() => void stop()}
								className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors"
								title="重启 Pi 进程"
							>
								<RotateCw className="w-3.5 h-3.5" />
							</button>
						)}
					</div>
				</header>

				{/* Main View Area */}
				<main className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
					{/* Auto-start / Loading State */}
					{(starting || !running) && !switching && (
						<div className="flex-1 flex items-center justify-center p-6">
							<div className="max-w-sm w-full text-center space-y-4">
								<div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md animate-pulse">
									π
								</div>
								<h2 className="text-base font-semibold text-slate-800">
									ordis-ai 工作台
								</h2>
								<p className="text-xs text-slate-500">正在连接并启动本地 Pi Agent…</p>
								{lastError && (
									<div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-600">
										{lastError}
									</div>
								)}
								{!starting && lastError && (
									<button
										onClick={() => void start()}
										className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl transition-all shadow-xs"
									>
										重试启动
									</button>
								)}
							</div>
						</div>
					)}

					{/* Switching Workspace / Session State */}
					{switching && (
						<div className="flex-1 flex items-center justify-center p-6">
							<div className="text-center space-y-3">
								<RotateCw className="w-6 h-6 text-slate-400 animate-spin mx-auto" />
								<p className="text-xs text-slate-500 font-medium">正在切换会话与工作区…</p>
							</div>
						</div>
					)}

					{/* Running Content */}
					{running && !switching && (
						<>
							{/* Empty / Welcome State (Tether-Inspired Card) */}
							{messages.length === 0 ? (
								<div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
									<div className="max-w-2xl w-full space-y-6 text-center">
										{/* Brand Mark */}
										<div className="space-y-2">
											<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200/80 text-xs text-slate-600 font-medium">
												<Sparkles className="w-3.5 h-3.5 text-slate-500" />
												<span>本地优先 AI 编码代理</span>
											</div>
											<h1 className="text-2xl font-bold text-slate-900 tracking-tight">
												ordis-ai
											</h1>
											<p className="text-xs text-slate-500 max-w-md mx-auto">
												基于 Pi 引擎构建，专注于精准的代码分析、架构重构与交互式自动化。
											</p>
										</div>

										{/* Floating Center Composer Card */}
										<div className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow p-3.5 text-left space-y-3">
											{/* Top workspace chip */}
											<div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
												<Folder className="w-3.5 h-3.5 text-slate-400" />
												<span className="font-medium text-slate-700">
													{workspaceName(currentWorkspace || "")}
												</span>
											</div>

											{/* Textarea */}
											<textarea
												ref={inputRef}
												value={input}
												onChange={(e) => {
													setInput(e.target.value);
													e.target.style.height = "auto";
													e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
												}}
												onKeyDown={onKeyDown}
												placeholder="输入需求或指令，让 Pi 协助您编写、分析或重构代码..."
												className="w-full bg-transparent text-slate-800 placeholder:text-slate-400 text-sm focus:outline-hidden resize-none min-h-[64px] max-h-48 leading-relaxed"
												rows={2}
											/>

											{/* Card Bottom Bar */}
											<div className="flex items-center justify-between pt-1 border-t border-slate-100">
												<div className="flex items-center gap-2 text-xs text-slate-500">
													<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200/80 text-[11px]">
														<ShieldCheck className="w-3 h-3 text-emerald-600" />
														<span>工作区已连接</span>
													</span>
												</div>

												<button
													onClick={onSubmit}
													disabled={!input.trim()}
													className="w-8 h-8 rounded-full bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-white flex items-center justify-center transition-all disabled:cursor-not-allowed shadow-xs"
													title="发送 (Enter)"
												>
													<ArrowUp className="w-4 h-4" />
												</button>
											</div>
										</div>

										{/* Quick Suggestion Pills */}
										<div className="flex flex-wrap items-center justify-center gap-2 max-w-lg mx-auto">
											<button
												onClick={() => handleQuickPrompt("请分析并解释当前工作区项目的整体架构与核心模块。")}
												className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-slate-100 border border-slate-200/90 text-xs text-slate-600 hover:text-slate-900 transition-colors shadow-2xs"
											>
												<FileSearch className="w-3.5 h-3.5 text-slate-400" />
												<span>解释当前项目架构</span>
											</button>
											<button
												onClick={() => handleQuickPrompt("请检查当前项目代码中潜在的 bug、性能隐患或优化点。")}
												className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-slate-100 border border-slate-200/90 text-xs text-slate-600 hover:text-slate-900 transition-colors shadow-2xs"
											>
												<Code className="w-3.5 h-3.5 text-slate-400" />
												<span>检查代码潜在问题</span>
											</button>
											<button
												onClick={() => handleQuickPrompt("请为当前工作区的核心函数与模块编写单元测试。")}
												className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-slate-100 border border-slate-200/90 text-xs text-slate-600 hover:text-slate-900 transition-colors shadow-2xs"
											>
												<Sparkles className="w-3.5 h-3.5 text-slate-400" />
												<span>生成模块测试用例</span>
											</button>
										</div>
									</div>
								</div>
							) : (
								/* Active Chat Conversation Stream */
								<div className="flex-1 flex flex-col min-h-0">
									<div
										ref={listRef}
										className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-2 select-text"
									>
										<div className="max-w-3xl mx-auto space-y-4">
											{messages.map((m) => (
												<Message key={m.id} message={m} streaming={m.streaming} />
											))}

											{tools.map((t) => (
												<div
													key={t.id}
													className="pl-9 my-2 border border-slate-200 bg-white rounded-xl p-2.5 text-xs shadow-xs"
												>
													<div className="flex items-center gap-2 text-slate-600 font-mono">
														<span
															className={`w-2 h-2 rounded-full ${
																t.status === "error"
																	? "bg-rose-500"
																	: t.status === "running"
																	? "bg-amber-500 animate-pulse"
																	: "bg-emerald-500"
															}`}
														/>
														<span className="font-semibold">{t.name}</span>
														<span className="text-slate-400 text-[11px]">
															{t.status === "running" ? "执行中…" : "已完成"}
														</span>
													</div>
													{t.result && (
														<pre className="mt-2 p-2 bg-slate-950 text-slate-200 rounded-lg text-[11px] font-mono overflow-x-auto max-h-48">
															{t.result}
														</pre>
													)}
												</div>
											))}
										</div>
									</div>

									{/* Sticky Bottom Floating Composer */}
									<div className="p-4 bg-gradient-to-t from-white via-white/95 to-transparent flex-shrink-0">
										<div className="max-w-3xl mx-auto">
											<div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm focus-within:border-slate-300 focus-within:shadow-md transition-all p-3 space-y-2">
												<textarea
													ref={inputRef}
													value={input}
													onChange={(e) => {
														setInput(e.target.value);
														e.target.style.height = "auto";
														e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
													}}
													onKeyDown={onKeyDown}
													placeholder={
														agentBusy
															? "Pi 正在思考与执行… (新消息将自动排队)"
															: "给 Pi 发送消息 (Shift+Enter 换行)..."
													}
													className="w-full bg-transparent text-slate-800 placeholder:text-slate-400 text-sm focus:outline-hidden resize-none min-h-[38px] max-h-36 leading-relaxed"
													rows={1}
												/>

												<div className="flex items-center justify-between pt-1">
													<div className="flex items-center gap-2 text-[11px] text-slate-400">
														<span>{currentModel?.name || "Pi Agent"}</span>
													</div>

													<div className="flex items-center gap-2">
														{agentBusy ? (
															<button
																onClick={() => void abort()}
																className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-medium transition-colors"
																title="停止 (Esc)"
															>
																<Square className="w-3 h-3 fill-rose-500 text-rose-500" />
																<span>停止</span>
															</button>
														) : (
															<button
																onClick={onSubmit}
																disabled={!input.trim()}
																className="w-7 h-7 rounded-full bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-white flex items-center justify-center transition-all disabled:cursor-not-allowed shadow-xs"
																title="发送 (Enter)"
															>
																<ArrowUp className="w-3.5 h-3.5" />
															</button>
														)}
													</div>
												</div>
											</div>
										</div>
									</div>
								</div>
							)}
						</>
					)}
				</main>
			</div>

			{/* Dialog Extension UI Modal */}
			{dialog && <ExtensionDialog d={dialog} answer={answerDialog} />}
		</div>
	);
}

/**
 * Modern Extension UI Dialog Modal (Confirm / Select / Input / Editor)
 */
function ExtensionDialog({
	d,
	answer,
}: {
	d: {
		id: string;
		method: string;
		title?: string;
		message?: string;
		options?: string[];
		placeholder?: string;
		prefill?: string;
	};
	answer: (value: string | null, confirmed?: boolean) => Promise<void>;
}) {
	const [text, setText] = useState(d.prefill ?? "");
	const [sel, setSel] = useState(d.options?.[0] ?? "");

	return (
		<div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-text">
			<div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
				<div className="space-y-1">
					<h3 className="text-sm font-semibold text-slate-900">
						{d.title ?? "Pi 请求交互确认"}
					</h3>
					{d.message && <p className="text-xs text-slate-500 leading-relaxed">{d.message}</p>}
				</div>

				{d.method === "confirm" && (
					<div className="flex justify-end gap-2 pt-2">
						<button
							onClick={() => void answer("", false)}
							className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium transition-colors"
						>
							取消
						</button>
						<button
							onClick={() => void answer("", true)}
							className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors shadow-xs"
						>
							确认
						</button>
					</div>
				)}

				{d.method === "select" && (
					<div className="space-y-3">
						<div className="max-h-56 overflow-y-auto space-y-1 p-1">
							{d.options?.map((o) => (
								<button
									key={o}
									onClick={() => setSel(o)}
									className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
										sel === o
											? "bg-slate-100 font-semibold text-slate-900 border border-slate-300"
											: "text-slate-600 hover:bg-slate-50 border border-transparent"
									}`}
								>
									{o}
								</button>
							))}
						</div>
						<div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
							<button
								onClick={() => void answer(null)}
								className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium transition-colors"
							>
								取消
							</button>
							<button
								onClick={() => void answer(sel)}
								className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors shadow-xs"
							>
								确认选择
							</button>
						</div>
					</div>
				)}

				{(d.method === "input" || d.method === "editor") && (
					<div className="space-y-3">
						{d.method === "editor" ? (
							<textarea
								value={text}
								onChange={(e) => setText(e.target.value)}
								className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-800 focus:outline-hidden min-h-[140px]"
							/>
						) : (
							<input
								value={text}
								placeholder={d.placeholder}
								onChange={(e) => setText(e.target.value)}
								className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden"
							/>
						)}
						<div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
							<button
								onClick={() => void answer(null)}
								className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium transition-colors"
							>
								取消
							</button>
							<button
								onClick={() => void answer(text)}
								className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors shadow-xs"
							>
								提交
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}


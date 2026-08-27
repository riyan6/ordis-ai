/**
 * ordis-ai desktop GUI — Minimalist white-theme workbench for Pi coding agent.
 * Inspired by Claude Code & Antigravity desktop aesthetics:
 * - Unified seamless titlebar with traffic light integration
 * - Smooth sidebar toggle with zero overlap
 * - Clean, borderless header & readable typography
 * - Unified Model + Thinking picker in input composer
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePiSession, type SessionInfo, type WorkspaceRecord } from "./use-pi-session";
import { Message, WorkingIndicator } from "./components/Message";
import {
	Plus,
	Folder,
	ChevronRight,
	ChevronDown,
	ChevronUp,
	ArrowUp,
	Square,
	Check,
	PanelLeftClose,
	PanelLeft,
	FolderPlus,
	Settings,
	MoreHorizontal,
	X
} from "lucide-react";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export default function App() {
	const {
		running,
		starting,
		messages,
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
		refresh,
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
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [asideCollapsed, setAsideCollapsed] = useState(false);
	const [expandedWs, setExpandedWs] = useState<string>(currentWorkspace || "");

	useEffect(() => {
		if (currentWorkspace && !expandedWs) setExpandedWs(currentWorkspace);
	}, [currentWorkspace, expandedWs]);

	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// Auto-scroll on new content
	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 250;
		if (nearBottom) el.scrollTop = el.scrollHeight;
	}, [messages, agentBusy]);

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

	const workspaceName = (p: string) => {
		const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
		return parts[parts.length - 1] || p || "未命名";
	};

	const onWsToggle = (path: string) => {
		setExpandedWs((prev) => (prev === path ? "" : path));
	};

	const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

	return (
		<div className="flex h-screen w-screen overflow-hidden bg-white text-[#1a1a1a] select-none">
			{/* ===== Aside (Left Rail, 110% width = 264px) ===== */}
			<aside
				className={`flex flex-col bg-[#fafafa] border-r border-black/[0.06] transition-[width,opacity] duration-150 z-20 shrink-0 ${
					asideCollapsed ? "w-0 opacity-0 overflow-hidden border-r-0 pointer-events-none" : "w-[264px] opacity-100"
				}`}
			>
				{/* Aside Top Bar: Mac traffic lights on left + sidebar collapse button */}
				<div
					className={`flex items-center h-10 wails-drag ${
						isMac ? "pl-[74px] pr-2.5" : "px-3 justify-end"
					}`}
				>
					<button
						onClick={() => setAsideCollapsed(true)}
						className="p-1 rounded-md text-neutral-400 hover:text-neutral-800 hover:bg-[#f0f0f0] transition-colors duration-150 wails-no-drag"
						title="折叠侧边栏"
					>
						<PanelLeftClose className="w-4 h-4" />
					</button>
				</div>

				{/* Aside Content */}
				<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
					{/* New Chat Button */}
					<div className="px-2.5 py-1.5">
						<button
							onClick={() => void newSession()}
							className="w-full flex items-center gap-2 py-1.5 px-2.5 text-neutral-700 hover:text-neutral-900 hover:bg-[#f0f0f0] bg-white border border-black/[0.06] text-[14px] font-medium rounded-lg transition-colors duration-150 group shadow-2xs"
						>
							<Plus className="w-4 h-4 text-neutral-500 group-hover:text-neutral-800" />
							<span>新会话</span>
						</button>
					</div>

					{/* Workspaces & Sessions Tree */}
					<div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
						<div>
							<div className="flex items-center justify-between px-2 pb-1 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
								<span>工作区</span>
								<button
									onClick={() => void addWorkspace()}
									className="p-0.5 rounded hover:bg-[#f0f0f0] text-neutral-400 hover:text-neutral-800 transition-colors duration-150"
									title="添加工作区"
								>
									<FolderPlus className="w-4 h-4" />
								</button>
							</div>

							{workspaces.length === 0 && (
								<div className="text-[13.5px] text-neutral-400 px-2 py-1.5">
									正在加载工作区…
								</div>
							)}

							<div className="space-y-0.5 mt-0.5">
								{workspaces.map((w) => {
									const isExpanded = expandedWs === w.path;
									const wsSess = sessions.filter((s) => s.workspace === w.path);

									return (
										<div key={w.id} className="space-y-0.5">
											{/* Workspace Header Row (Hover only background) */}
											<div
												onClick={() => onWsToggle(w.path)}
												className="group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[14px] text-neutral-800 hover:bg-[#f0f0f0] hover:text-neutral-950 cursor-pointer transition-colors duration-150 relative"
												title={w.path}
											>
												<div className="flex items-center gap-2 min-w-0 flex-1">
													<Folder className="w-4 h-4 text-neutral-700 flex-shrink-0" />
													<span className="truncate">{w.name}</span>
												</div>

												{/* Hover Action Buttons: More options & Add Session */}
												<div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0 ml-1">
													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															onWsToggle(w.path);
														}}
														className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/70 transition-colors"
														title="展开/折叠"
													>
														<MoreHorizontal className="w-3.5 h-3.5" />
													</button>
													<button
														type="button"
														onClick={async (e) => {
															e.stopPropagation();
															if (w.path !== currentWorkspace) {
																await switchWorkspace(w.path);
															}
															await newSession();
															setExpandedWs(w.path);
															setTimeout(() => inputRef.current?.focus(), 50);
														}}
														className="p-1 rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-neutral-200/70 transition-colors"
														title="在此工作区新建会话"
													>
														<Plus className="w-3.5 h-3.5" />
													</button>
												</div>
											</div>

											{/* Sessions under this Workspace (Selected session has background, no left border) */}
											{isExpanded && (
												<div className="py-0.5 space-y-0.5">
													{wsSess.slice(0, 15).map((s) => {
														const isCurrentSession = state?.sessionId === s.id;
														return (
															<button
																key={s.id}
																onClick={() => void resume(s)}
																className={`w-full flex items-center justify-between px-3 py-1.5 pl-7 rounded-xl text-[13.5px] text-left transition-colors duration-150 ${
																	isCurrentSession
																		? "bg-[#ececec] font-medium text-neutral-900"
																		: "text-neutral-700 hover:bg-[#f0f0f0] hover:text-neutral-900"
																}`}
																title={s.name || s.id}
															>
																<span className="truncate flex-1 pr-1.5">
																	{s.name || "未命名会话"}
																</span>
															</button>
														);
													})}

													{wsSess.length === 0 && (
														<div className="text-[13px] text-neutral-400 px-3 py-1 pl-7">
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

					{/* Aside Footer: Clean Settings Entry (No line above) */}
					<div className="p-2.5 mt-auto">
						<button
							onClick={() => setSettingsOpen(true)}
							className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[14px] text-neutral-600 hover:text-neutral-900 hover:bg-[#f0f0f0] transition-colors duration-150"
						>
							<Settings className="w-4 h-4 text-neutral-500" />
							<span>设置</span>
						</button>
					</div>
				</div>
			</aside>

			{/* ===== Main Pane ===== */}
			<div className="flex-1 flex flex-col min-w-0 h-full bg-white relative">
				{/* Top Navigation Bar: Seamless, Clean Breadcrumb (No Stop Button) */}
				<header className="h-10 bg-white flex items-center justify-between flex-shrink-0 z-10 select-none wails-drag">
					{/* Left: Sidebar Expand Button (when collapsed) + Breadcrumb */}
					<div
						className={`flex items-center gap-2 min-w-0 flex-1 ${
							asideCollapsed ? (isMac ? "pl-[74px] pr-2" : "px-3") : "px-4"
						}`}
					>
						{asideCollapsed && (
							<button
								onClick={() => setAsideCollapsed(false)}
								className="p-1 rounded-md text-neutral-400 hover:text-neutral-800 hover:bg-[#f0f0f0] transition-colors duration-150 wails-no-drag"
								title="展开侧边栏"
							>
								<PanelLeft className="w-4 h-4" />
							</button>
						)}

						<div className="flex items-center gap-1.5 text-[13.5px] text-neutral-600 truncate">
							<span className="font-medium text-neutral-800 truncate">
								{workspaceName(currentWorkspace || "")}
							</span>
							<span className="text-neutral-300">/</span>
							<span className="text-neutral-500 truncate max-w-sm">
								{currentSessionTitle}
							</span>
						</div>
					</div>
				</header>

				{/* Main View Area */}
				<main className="flex-1 flex flex-col min-h-0 relative overflow-hidden bg-white">
					{/* Auto-start / Loading State */}
					{(starting || !running) && !switching && (
						<div className="flex-1 flex items-center justify-center p-6">
							<div className="max-w-xs w-full text-center space-y-3">
								<h2 className="text-base font-semibold text-neutral-800">
									ordis-ai
								</h2>
								<p className="text-[13.5px] text-neutral-400">正在连接本地 Pi Agent…</p>
								{lastError && (
									<div className="p-2.5 rounded-md bg-[#fef2f2] text-xs text-rose-600">
										{lastError}
									</div>
								)}
								{!starting && lastError && (
									<button
										onClick={() => void start()}
										className="px-3.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium rounded-md transition-colors duration-150"
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
							<div className="text-center space-y-2">
								<p className="text-[13.5px] text-neutral-400 font-medium">正在切换会话与工作区…</p>
							</div>
						</div>
					)}

					{/* Running Content */}
					{running && !switching && (
						<>
							{/* Empty / Welcome State */}
							{messages.length === 0 ? (
								<div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
									<div className="max-w-xl w-full space-y-4 text-center">
										{/* Workspace Decoration & Selector Block */}
										<div className="flex items-center justify-center">
											<WorkspacePickerPill
												workspaces={workspaces}
												currentWorkspace={currentWorkspace}
												onSelectWorkspace={async (path) => {
													if (path !== currentWorkspace) {
														await switchWorkspace(path);
													}
													await newSession();
													setExpandedWs(path);
												}}
												onAddWorkspace={addWorkspace}
											/>
										</div>

										{/* Clean Center Composer (Pure White + Elegant Shadow, NO Gray) */}
										<div className="bg-white border border-black/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.04)] rounded-2xl p-4 text-left space-y-2">
											<textarea
												ref={inputRef}
												value={input}
												onChange={(e) => {
													setInput(e.target.value);
													e.target.style.height = "auto";
													e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
												}}
												onKeyDown={onKeyDown}
												placeholder="随心输入需求或指令，让 Pi 协助您编写、分析或重构代码..."
												className="w-full bg-transparent text-neutral-900 placeholder:text-neutral-400 text-[15px] focus:outline-hidden resize-none min-h-[64px] max-h-48 leading-relaxed border-0 outline-none ring-0 shadow-none"
												rows={2}
											/>

											<div className="flex items-center justify-between pt-1">
												{/* Left: Plus button + Model/Thinking Picker */}
												<div className="flex items-center gap-1.5">
													<button
														type="button"
														className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-[#f0f0f0] transition-colors"
														title="添加附件或扩展"
													>
														<Plus className="w-4 h-4" />
													</button>

													<ModelThinkingPicker
														models={models}
														currentModel={currentModel}
														currentThinkingLevel={currentThinkingLevel}
														onSwitchModel={switchModel}
														onChangeThinking={changeThinking}
														onRefresh={refresh}
													/>
												</div>

												<button
													onClick={onSubmit}
													disabled={!input.trim()}
													className="w-8 h-8 rounded-full bg-neutral-900 hover:bg-neutral-800 disabled:opacity-20 text-white flex items-center justify-center transition-colors duration-150 disabled:cursor-not-allowed shadow-xs"
													title="发送 (Enter)"
												>
													<ArrowUp className="w-4 h-4" />
												</button>
											</div>
										</div>
									</div>
								</div>
							) : (
								/* Active Chat Conversation Stream */
								<div className="flex-1 flex flex-col min-h-0">
									<div
										ref={listRef}
										className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-4 select-text"
									>
										<div className="max-w-3xl mx-auto space-y-4">
											{messages.map((m) => (
												<Message key={m.id} message={m} streaming={m.streaming} />
											))}

											{/* Working indicator when agent is busy and waiting for response */}
											{agentBusy && !messages.some((m) => m.streaming) && (
												<div className="my-3">
													<WorkingIndicator />
												</div>
											)}
										</div>
									</div>

									{/* Sticky Bottom Floating Composer (Pure White + Soft Floating Shadow) */}
									<div className="p-4 bg-white flex-shrink-0">
										<div className="max-w-3xl mx-auto">
											<div className="bg-white border border-black/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.04)] rounded-2xl p-3 transition-colors space-y-1.5">
												<textarea
													ref={inputRef}
													value={input}
													onChange={(e) => {
														setInput(e.target.value);
														e.target.style.height = "auto";
														e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
													}}
													onKeyDown={onKeyDown}
													placeholder="随心输入 (Shift+Enter 换行)..."
													className="w-full bg-transparent text-neutral-900 placeholder:text-neutral-400 text-[15px] focus:outline-hidden resize-none min-h-[40px] max-h-36 leading-relaxed border-0 outline-none ring-0 shadow-none"
													rows={1}
												/>

												<div className="flex items-center justify-between pt-1">
													{/* Left: Plus button + Model/Thinking Picker */}
													<div className="flex items-center gap-1.5">
														<button
															type="button"
															className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-[#f0f0f0] transition-colors"
															title="添加附件或扩展"
														>
															<Plus className="w-4 h-4" />
														</button>

														<ModelThinkingPicker
															models={models}
															currentModel={currentModel}
															currentThinkingLevel={currentThinkingLevel}
															onSwitchModel={switchModel}
															onChangeThinking={changeThinking}
															onRefresh={refresh}
														/>
													</div>

													<div className="flex items-center gap-1.5">
														{agentBusy ? (
															<button
																onClick={() => void abort()}
																className="w-8 h-8 rounded-full bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white flex items-center justify-center transition-colors duration-150 wails-no-drag shadow-xs cursor-pointer"
																title="停止生成 (Esc)"
															>
																<Square className="w-3.5 h-3.5 fill-white text-white" />
															</button>
														) : (
															<button
																onClick={onSubmit}
																disabled={!input.trim()}
																className="w-8 h-8 rounded-full bg-neutral-900 hover:bg-neutral-800 disabled:opacity-20 text-white flex items-center justify-center transition-colors duration-150 disabled:cursor-not-allowed wails-no-drag shadow-xs"
																title="发送 (Enter)"
															>
																<ArrowUp className="w-4 h-4" />
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

			{/* Settings Panel / Modal */}
			{settingsOpen && (
				<SettingsModal
					onClose={() => setSettingsOpen(false)}
					currentWorkspace={currentWorkspace}
					currentModel={currentModel}
					currentThinkingLevel={currentThinkingLevel}
					models={models}
					onSwitchModel={switchModel}
					onChangeThinking={changeThinking}
					onOpenWorkspace={addWorkspace}
				/>
			)}

			{/* Dialog Extension UI Modal */}
			{dialog && <ExtensionDialog d={dialog} answer={answerDialog} />}
		</div>
	);
}

/**
 * Workspace Selector Pill / Decoration Block for the Welcome State
 */
function WorkspacePickerPill({
	workspaces,
	currentWorkspace,
	onSelectWorkspace,
	onAddWorkspace,
}: {
	workspaces: WorkspaceRecord[];
	currentWorkspace: string;
	onSelectWorkspace: (path: string) => Promise<void>;
	onAddWorkspace: () => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const activeWs = workspaces.find((w) => w.path === currentWorkspace);
	const displayName =
		activeWs?.name ||
		(currentWorkspace ? currentWorkspace.replace(/\\/g, "/").split("/").pop() : "选择工作区");

	return (
		<div className="relative inline-flex" ref={ref}>
			{/* Pill Button: Clean light pill above the input box */}
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#f4f4f5] hover:bg-[#eaeaea] text-neutral-800 text-[13px] font-medium transition-colors duration-150 cursor-pointer select-none border border-black/[0.04] shadow-2xs"
				title="选择工作区"
			>
				<Folder className="w-3.5 h-3.5 text-neutral-600" />
				<span className="truncate max-w-[220px]">{displayName}</span>
				<ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
			</button>

			{/* Dropdown Popover */}
			{open && (
				<div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 w-72 bg-white border border-black/[0.08] rounded-2xl shadow-xl p-1.5 select-none text-left animate-in fade-in zoom-in-95 duration-100">
					<div className="px-2.5 py-1 text-xs font-semibold text-neutral-400">
						选择工作区
					</div>
					<div className="max-h-60 overflow-y-auto space-y-0.5 mt-0.5">
						{workspaces.map((w) => {
							const isSelected = w.path === currentWorkspace;
							return (
								<button
									key={w.id}
									type="button"
									onClick={() => {
										void onSelectWorkspace(w.path);
										setOpen(false);
									}}
									className={`w-full text-left px-3 py-2 rounded-xl text-[13px] flex items-center justify-between transition-colors ${
										isSelected
											? "bg-[#f0f0f0] text-neutral-900 font-medium"
											: "text-neutral-700 hover:bg-[#f5f5f5] hover:text-neutral-900"
									}`}
								>
									<div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
										<Folder className="w-3.5 h-3.5 text-neutral-500 flex-shrink-0" />
										<span className="truncate">{w.name}</span>
									</div>
									{isSelected && <Check className="w-3.5 h-3.5 text-neutral-800 flex-shrink-0" />}
								</button>
							);
						})}

						{workspaces.length === 0 && (
							<div className="px-3 py-2 text-xs text-neutral-400">
								暂无已注册工作区
							</div>
						)}
					</div>

					<div className="pt-1 mt-1 border-t border-black/[0.06]">
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								void onAddWorkspace();
							}}
							className="w-full text-left px-3 py-1.5 rounded-xl text-[13px] text-neutral-600 hover:text-neutral-900 hover:bg-[#f5f5f5] flex items-center gap-2 transition-colors cursor-pointer"
						>
							<FolderPlus className="w-3.5 h-3.5 text-neutral-500" />
							<span>添加新工作区...</span>
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * Unified Model + Thinking Picker (Integrated inside the input composer)
 */
function ModelThinkingPicker({
	models,
	currentModel,
	currentThinkingLevel,
	onSwitchModel,
	onChangeThinking,
	onRefresh,
}: {
	models: Array<{ id: string; name: string; provider: string }>;
	currentModel?: { id: string; name?: string; provider?: string } | null;
	currentThinkingLevel: string;
	onSwitchModel: (id: string) => Promise<void>;
	onChangeThinking: (level: string) => Promise<void>;
	onRefresh?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	// Close on outside click
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setOpen(false);
				setHoveredModelId(null);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Keyboard shortcut: Cmd + / or Ctrl + /
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === "/") {
				e.preventDefault();
				setOpen((prev) => {
					if (!prev) onRefresh?.();
					return !prev;
				});
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onRefresh]);

	const thinkingDisplayName = (lvl: string) => {
		if (!lvl || lvl === "off") return "";
		if (lvl === "xhigh") return "XHigh";
		return lvl.charAt(0).toUpperCase() + lvl.slice(1);
	};

	// Fallback to currentModel if models list is still populating
	const displayModels: Array<{ id: string; name: string; provider?: string }> = useMemo(() => {
		if (models && models.length > 0) return models;
		if (currentModel) {
			return [{ id: currentModel.id, name: currentModel.name || currentModel.id, provider: currentModel.provider || "" }];
		}
		return [];
	}, [models, currentModel]);

	const thinkingOptions = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

	return (
		<div className="relative inline-flex items-center gap-1.5" ref={menuRef}>
			{/* Model + Thinking Button: Completely clean/flat by default, subtle hover */}
			<button
				type="button"
				onClick={() => {
					setOpen(!open);
					if (!open) {
						onRefresh?.();
						setHoveredModelId(null);
					}
				}}
				className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-neutral-800 hover:text-neutral-950 text-[13.5px] font-medium transition-colors duration-150 cursor-pointer select-none ${
					open ? "bg-[#e8e8e8] text-neutral-900" : "bg-transparent hover:bg-[#e8e8e8]"
				}`}
				title="选择模型 (⌘ /)"
			>
				<span>{currentModel?.name || "选择模型"}</span>
				{currentThinkingLevel && currentThinkingLevel !== "off" && (
					<span className="text-neutral-400 font-normal text-xs ml-0.5">
						{thinkingDisplayName(currentThinkingLevel)}
					</span>
				)}
				<ChevronUp className="w-3.5 h-3.5 text-neutral-400 ml-0.5" />
			</button>

			{/* The Popover Menu */}
			{open && (
				<div className="absolute bottom-full mb-2 left-0 z-50 w-68 bg-white border border-black/[0.08] rounded-2xl shadow-xl p-1.5 select-none overflow-visible">
					<div className="px-2.5 py-1 text-xs font-semibold text-neutral-400">
						Model
					</div>
					<div className="space-y-0.5 mt-0.5">
						{displayModels.map((m) => {
							const isSelected = currentModel?.id === m.id;
							const isHovered = hoveredModelId === m.id;

							return (
								<div
									key={m.id}
									className="relative"
									onMouseEnter={() => setHoveredModelId(m.id)}
									onMouseLeave={() => setHoveredModelId(null)}
								>
									{/* Model Item Row */}
									<button
										type="button"
										onClick={() => {
											void onSwitchModel(m.id);
											setOpen(false);
											setHoveredModelId(null);
										}}
										className={`w-full text-left px-3 py-2 rounded-xl text-[13.5px] flex items-center justify-between transition-colors ${
											isHovered
												? "bg-[#f0f0f0] text-neutral-900 font-medium"
												: isSelected
												? "bg-[#f7f7f8] text-neutral-900 font-medium"
												: "text-neutral-700 hover:bg-[#f0f0f0] hover:text-neutral-900"
										}`}
									>
										<div className="flex items-center gap-1.5 truncate flex-1 min-w-0 pr-1">
											<span className="truncate">{m.name}</span>
											{isSelected && currentThinkingLevel !== "off" && (
												<span className="text-neutral-400 text-xs font-normal">
													{thinkingDisplayName(currentThinkingLevel)}
												</span>
											)}
										</div>

										<div className="flex items-center gap-1 flex-shrink-0">
											{isSelected && <Check className="w-3.5 h-3.5 text-neutral-800" />}
											<ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
										</div>
									</button>

									{/* Thinking Submenu — Positioned directly at top-0 of this row, perfectly adjacent */}
									{isHovered && (
										<div className="absolute left-full top-0 ml-1.5 w-28 bg-white border border-black/[0.08] rounded-xl shadow-xl p-1 z-50 animate-in fade-in duration-100">
											{thinkingOptions.map((lvl) => {
												const isLvlSelected = isSelected && currentThinkingLevel === lvl;
												return (
													<button
														key={lvl}
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															void onSwitchModel(m.id);
															void onChangeThinking(lvl);
															setOpen(false);
															setHoveredModelId(null);
														}}
														className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors ${
															isLvlSelected
																? "bg-[#f0f0f0] font-medium text-neutral-900"
																: "text-neutral-600 hover:bg-[#f0f0f0] hover:text-neutral-900"
														}`}
													>
														<span>{thinkingDisplayName(lvl) || "Off"}</span>
														{isLvlSelected && (
															<Check className="w-3 h-3 text-neutral-800" />
														)}
													</button>
												);
											})}
										</div>
									)}
								</div>
							);
						})}

						{displayModels.length === 0 && (
							<div className="px-3 py-2 text-xs text-neutral-400">
								暂无可用模型
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * Clean Settings Modal
 */
function SettingsModal({
	onClose,
	currentWorkspace,
	currentModel,
	currentThinkingLevel,
	models,
	onSwitchModel,
	onChangeThinking,
	onOpenWorkspace,
}: {
	onClose: () => void;
	currentWorkspace: string;
	currentModel?: { id: string; name?: string; provider?: string } | null;
	currentThinkingLevel: string;
	models: Array<{ id: string; name: string; provider: string }>;
	onSwitchModel: (id: string) => Promise<void>;
	onChangeThinking: (level: string) => Promise<void>;
	onOpenWorkspace: () => Promise<void>;
}) {
	return (
		<div className="fixed inset-0 bg-black/25 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-text">
			<div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 border border-black/[0.08] shadow-xl">
				{/* Modal Header */}
				<div className="flex items-center justify-between pb-2 border-b border-black/[0.06]">
					<h3 className="text-sm font-semibold text-neutral-900">设置</h3>
					<button
						onClick={onClose}
						className="p-1 rounded-md text-neutral-400 hover:text-neutral-800 hover:bg-[#f0f0f0] transition-colors duration-150"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{/* Modal Body */}
				<div className="space-y-4 text-xs">
					{/* Workspace */}
					<div className="space-y-1.5">
						<label className="font-medium text-neutral-700">当前工作区</label>
						<div className="p-2 bg-[#f7f7f8] rounded-md font-mono text-[11.5px] text-neutral-600 break-all flex items-center justify-between gap-2">
							<span className="truncate">{currentWorkspace || "未设置"}</span>
							<button
								onClick={() => {
									void onOpenWorkspace();
								}}
								className="px-2 py-1 bg-white hover:bg-[#f0f0f0] text-neutral-700 rounded border border-black/[0.06] flex-shrink-0 transition-colors duration-150"
							>
								更改
							</button>
						</div>
					</div>

					{/* Model Selection */}
					<div className="space-y-1.5">
						<label className="font-medium text-neutral-700">默认模型</label>
						<div className="max-h-36 overflow-y-auto space-y-0.5 p-1 bg-[#f7f7f8] rounded-md">
							{models.map((m) => (
								<button
									key={m.id}
									onClick={() => void onSwitchModel(m.id)}
									className={`w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between transition-colors duration-150 ${
										currentModel?.id === m.id
											? "bg-white font-medium text-neutral-900 shadow-xs"
											: "text-neutral-600 hover:bg-white/60"
									}`}
								>
									<span>{m.name}</span>
									<span className="text-[10px] text-neutral-400 font-mono">{m.provider}</span>
								</button>
							))}
						</div>
					</div>

					{/* Thinking Level */}
					<div className="space-y-1.5">
						<label className="font-medium text-neutral-700">思考等级</label>
						<div className="flex flex-wrap gap-1">
							{THINKING_LEVELS.map((lvl) => (
								<button
									key={lvl}
									onClick={() => void onChangeThinking(lvl)}
									className={`px-2 py-1 rounded text-xs transition-colors duration-150 ${
										currentThinkingLevel === lvl
											? "bg-neutral-900 text-white font-medium"
											: "bg-[#f7f7f8] text-neutral-600 hover:bg-[#ebebeb]"
									}`}
								>
									{lvl}
								</button>
							))}
						</div>
					</div>

					{/* About */}
					<div className="pt-2 border-t border-black/[0.06] text-neutral-400 text-[11px] flex justify-between">
						<span>ordis-ai · Pi Coding Agent GUI</span>
						<span>v0.1.0</span>
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * Extension UI Dialog Modal (Confirm / Select / Input / Editor)
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
		<div className="fixed inset-0 bg-black/25 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-text">
			<div className="bg-white rounded-xl p-5 max-w-md w-full border border-black/[0.08] shadow-xl space-y-3.5">
				<div className="space-y-1">
					<h3 className="text-sm font-semibold text-neutral-900">
						{d.title ?? "交互确认"}
					</h3>
					{d.message && <p className="text-xs text-neutral-500 leading-relaxed">{d.message}</p>}
				</div>

				{d.method === "confirm" && (
					<div className="flex justify-end gap-2 pt-2">
						<button
							onClick={() => void answer("", false)}
							className="px-3 py-1.5 rounded-md hover:bg-[#f0f0f0] text-neutral-600 text-xs transition-colors duration-150"
						>
							取消
						</button>
						<button
							onClick={() => void answer("", true)}
							className="px-3.5 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium transition-colors duration-150"
						>
							确认
						</button>
					</div>
				)}

				{d.method === "select" && (
					<div className="space-y-2.5">
						<div className="max-h-56 overflow-y-auto space-y-0.5 p-1 bg-[#f7f7f8] rounded-md">
							{d.options?.map((o) => (
								<button
									key={o}
									onClick={() => setSel(o)}
									className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors duration-150 ${
										sel === o
											? "bg-white font-medium text-neutral-900 shadow-xs"
											: "text-neutral-600 hover:bg-white/60"
									}`}
								>
									{o}
								</button>
							))}
						</div>
						<div className="flex justify-end gap-2 pt-1 border-t border-black/[0.06]">
							<button
								onClick={() => void answer(null)}
								className="px-3 py-1.5 rounded-md hover:bg-[#f0f0f0] text-neutral-600 text-xs transition-colors duration-150"
							>
								取消
							</button>
							<button
								onClick={() => void answer(sel)}
								className="px-3.5 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium transition-colors duration-150"
							>
								确认选择
							</button>
						</div>
					</div>
				)}

				{(d.method === "input" || d.method === "editor") && (
					<div className="space-y-2.5">
						{d.method === "editor" ? (
							<textarea
								value={text}
								onChange={(e) => setText(e.target.value)}
								className="w-full p-2.5 bg-[#f7f7f8] rounded-lg font-mono text-xs text-neutral-800 focus:outline-hidden min-h-[140px]"
							/>
						) : (
							<input
								value={text}
								placeholder={d.placeholder}
								onChange={(e) => setText(e.target.value)}
								className="w-full px-3 py-2 bg-[#f7f7f8] rounded-lg text-xs text-neutral-800 focus:outline-hidden"
							/>
						)}
						<div className="flex justify-end gap-2 pt-1 border-t border-black/[0.06]">
							<button
								onClick={() => void answer(null)}
								className="px-3 py-1.5 rounded-md hover:bg-[#f0f0f0] text-neutral-600 text-xs transition-colors duration-150"
							>
								取消
							</button>
							<button
								onClick={() => void answer(text)}
								className="px-3.5 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium transition-colors duration-150"
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

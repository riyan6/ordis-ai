/**
 * ordis-ai desktop GUI — Minimalist white-theme workbench for Pi coding agent.
 * Inspired by Claude Code & Antigravity desktop aesthetics:
 * - Unified seamless titlebar with traffic light integration
 * - Smooth sidebar toggle with zero overlap
 * - Clean, borderless header & readable typography
 * - Unified Model + Thinking picker in input composer
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePiSession, type ProviderInfo } from "./use-pi-session";
import { Message, WorkingIndicator } from "./components/Message";
import {
	Plus,
	Folder,
	PanelLeftClose,
	PanelLeft,
	FolderPlus,
	Settings,
	MoreHorizontal,
	Trash2,
	Bot,
	Palette,
	Check,
	Info,
	X
} from "lucide-react";
import { Composer } from "./components/Composer";

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
		providers,
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
		loadProviders,
		resume,
		deleteSession,
		deleteProvider,
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
		if (currentWorkspace) setExpandedWs(currentWorkspace);
	}, [currentWorkspace]);

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

	const composerCommon = {
		input,
		onInputChange: setInput,
		onSubmit,
		onKeyDown,
		inputRef,
		agentBusy,
		onAbort: () => void abort(),
		models,
		currentModel,
		currentThinkingLevel,
		onSwitchModel: switchModel,
		onChangeThinking: changeThinking,
		onRefreshModels: refresh,
		workspaces,
		currentWorkspace,
		onAddWorkspace: addWorkspace,
	};

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
															<div
																key={s.id}
																className={`group/session w-full flex items-center rounded-xl text-[13.5px] transition-colors duration-150 ${
																	isCurrentSession
																		? "bg-[#ececec] font-medium text-neutral-900"
																		: "text-neutral-700 hover:bg-[#f0f0f0] hover:text-neutral-900"
																}`}
															>
																<button
																	type="button"
																	onClick={() => void resume(s)}
																	className="min-w-0 flex-1 px-3 py-1.5 pl-7 text-left"
																	title={s.name || s.id}
																>
																	<span className="block truncate">{s.name || "未命名会话"}</span>
																</button>
																<button
																	type="button"
																	onClick={() => void deleteSession(s)}
																	className="mr-1 hidden group-hover/session:flex p-1 rounded-md text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
																	title="删除会话"
																	aria-label={`删除会话 ${s.name || s.id}`}
																>
																	<Trash2 className="w-3.5 h-3.5" />
																</button>
															</div>
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
							onClick={() => {
								setSettingsOpen(true);
								void loadProviders();
							}}
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
						<div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-white/70 backdrop-blur-[1px]">
							<div className="rounded-lg bg-white/90 px-4 py-2 shadow-sm border border-black/[0.06]">
								<p className="text-[13.5px] text-neutral-500 font-medium">正在切换会话与工作区…</p>
							</div>
						</div>
					)}

					{/* Running Content */}
					{running && (
						<>
							{/* Empty / Welcome State */}
							{messages.length === 0 ? (
								<div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
									<div className="max-w-4xl w-full">
										<Composer
											variant="welcome"
											{...composerCommon}
							onSelectWorkspace={async (path) => {
								if (path !== currentWorkspace) {
									await switchWorkspace(path);
								} else {
									await newSession();
								}
								setExpandedWs(path);
											}}
										/>
									</div>
								</div>
							) : (
								/* Active Chat Conversation Stream */
								<div className="flex-1 flex flex-col min-h-0">
									<div
										ref={listRef}
										className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-4 select-text"
									>
										<div className="max-w-4xl mx-auto space-y-4">
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

									{/* Sticky Bottom Composer */}
									<div className="p-4 bg-white flex-shrink-0">
										<div className="max-w-4xl mx-auto">
											<Composer
												variant="chat"
												{...composerCommon}
												onSelectWorkspace={async (path) => {
													if (path !== currentWorkspace) {
														await switchWorkspace(path);
													}
													setExpandedWs(path);
												}}
											/>
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
					currentModel={currentModel}
					models={models}
					providers={providers}
					onSwitchModel={switchModel}
					onDeleteProvider={deleteProvider}
				/>
			)}

			{/* Dialog Extension UI Modal */}
			{dialog && <ExtensionDialog d={dialog} answer={answerDialog} />}
		</div>
	);
}

/** Settings window with navigation on the left and page content on the right. */
function SettingsModal({
	onClose,
	currentModel,
	models,
	providers,
	onSwitchModel,
	onDeleteProvider,
}: {
	onClose: () => void;
	currentModel?: { id: string; name?: string; provider?: string } | null;
	models: Array<{ id: string; name: string; provider: string }>;
	providers: ProviderInfo[];
	onSwitchModel: (provider: string, modelId: string) => Promise<void>;
	onDeleteProvider: (providerID: string) => Promise<void>;
}) {
	const [page, setPage] = useState<"providers" | "theme">("providers");
	const [selectedProvider, setSelectedProvider] = useState("");
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState("");

	const displayProviders: ProviderInfo[] = providers
		.filter((provider) => !provider.disabled)
		.map((provider) => ({ ...provider }));
	for (const model of models) {
		if (!displayProviders.some((provider) => provider.id === model.provider)) {
			displayProviders.push({
				id: model.provider,
				hasCredential: false,
				hasCustomConfig: false,
				default: false,
				deletable: true,
				disabled: false,
			});
		}
	}
	displayProviders.sort((a, b) => {
		if (a.default !== b.default) return a.default ? -1 : 1;
		return a.id.localeCompare(b.id);
	});

	useEffect(() => {
		if (displayProviders.some((provider) => provider.id === selectedProvider)) return;
		const preferred =
			displayProviders.find((provider) => provider.id === currentModel?.provider) ?? displayProviders[0];
		setSelectedProvider(preferred?.id ?? "");
	}, [providers, models, currentModel?.provider, selectedProvider]);

	const selected = displayProviders.find((provider) => provider.id === selectedProvider);
	const selectedModels = models.filter((model) => model.provider === selectedProvider);
	const deleteSelectedProvider = async () => {
		if (!selected?.deletable || deleting) return;
		const confirmed = window.confirm(
			`确定删除供应商“${selected.id}”吗？\n\n该供应商及其全部模型会从 ordis-ai 中隐藏，同时删除 Pi 中保存的凭据和自定义模型配置。此操作无法撤销。`,
		);
		if (!confirmed) return;
		setDeleting(true);
		setDeleteError("");
		try {
			await onDeleteProvider(selected.id);
		} catch (e: any) {
			setDeleteError(String(e?.message ?? e));
		} finally {
			setDeleting(false);
		}
	};

	return (
		<div className="fixed inset-0 bg-black/25 backdrop-blur-[2px] flex items-center justify-center z-50 p-4 select-text">
			<div className="flex w-[min(1080px,calc(100vw-32px))] h-[min(720px,calc(100vh-32px))] min-h-[520px] overflow-hidden rounded-2xl bg-white border border-black/[0.08] shadow-2xl">
				<aside className="flex w-56 flex-shrink-0 flex-col bg-[#fafafa] border-r border-black/[0.06] px-3 py-6">
					<div className="px-3 pb-2 text-[12px] font-semibold tracking-wide text-neutral-400">模型与服务</div>
					<button
						type="button"
						onClick={() => setPage("providers")}
						className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] text-left transition-colors ${
							page === "providers"
								? "bg-[#ededed] text-neutral-900 font-medium"
								: "text-neutral-600 hover:bg-black/[0.04]"
						}`}
					>
						<Bot className="w-4 h-4" />
						<span>模型与供应商</span>
					</button>

					<div className="px-3 pt-7 pb-2 text-[12px] font-semibold tracking-wide text-neutral-400">外观</div>
					<button
						type="button"
						onClick={() => setPage("theme")}
						className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] text-left transition-colors ${
							page === "theme"
								? "bg-[#ededed] text-neutral-900 font-medium"
								: "text-neutral-600 hover:bg-black/[0.04]"
						}`}
					>
						<Palette className="w-4 h-4" />
						<span>主题</span>
					</button>

					<div className="mt-auto px-3 pt-7 flex items-center gap-2 text-[12px] text-neutral-400">
						<Info className="w-3.5 h-3.5" />
						<span>ordis-ai v0.1.0</span>
					</div>
				</aside>

				<section className="min-w-0 flex-1 flex flex-col bg-white">
					<header className="h-[74px] flex-shrink-0 flex items-center justify-between px-8 border-b border-black/[0.08]">
						<h2 className="text-[20px] font-semibold text-neutral-900">
							{page === "providers" ? "模型与供应商" : "主题"}
						</h2>
						<button
							type="button"
							onClick={onClose}
							className="p-2 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-black/[0.05] transition-colors"
							aria-label="关闭设置"
						>
							<X className="w-5 h-5" />
						</button>
					</header>

					{page === "providers" ? (
						<div className="min-h-0 flex-1 flex flex-col px-8 py-6">
							<div className="mb-5">
								<h3 className="text-[15px] font-semibold text-neutral-900">Pi 供应商配置</h3>
								<p className="mt-1 text-[13px] leading-relaxed text-neutral-500">
									删除供应商后，其模型会同时从设置和聊天模型列表中隐藏。API Key 不会显示在界面中。
								</p>
							</div>

							<div className="min-h-0 flex-1 grid grid-cols-[260px_minmax(0,1fr)] border border-black/[0.08] rounded-2xl overflow-hidden bg-white">
								<div className="min-h-0 border-r border-black/[0.08] p-3 flex flex-col">
									<div className="px-2 pb-2 flex items-center justify-between">
										<span className="text-[12px] font-semibold text-neutral-500">供应商</span>
										<span className="text-[11px] text-neutral-400">{displayProviders.length}</span>
									</div>
									<div className="min-h-0 overflow-y-auto space-y-1">
										{displayProviders.map((provider) => {
											const count = models.filter((model) => model.provider === provider.id).length;
											const active = provider.id === selectedProvider;
											return (
												<button
													key={provider.id}
													type="button"
													onClick={() => {
														setSelectedProvider(provider.id);
														setDeleteError("");
													}}
													className={`w-full px-3 py-3 rounded-xl text-left border transition-colors ${
														active
													? "border-neutral-400 bg-[#f5f5f5]"
													: "border-transparent hover:bg-[#f5f5f5]"
													}`}
												>
													<div className="flex items-center gap-2">
														<span className={`w-2 h-2 rounded-full ${count > 0 ? "bg-emerald-500" : "bg-neutral-300"}`} />
														<span className="truncate text-[14px] font-medium text-neutral-900">{provider.id}</span>
													</div>
													<div className="mt-1 pl-4 text-[12px] text-neutral-400">
														{count > 0 ? `${count} 个可用模型` : "当前无可用模型"}
													</div>
												</button>
											);
										})}
										{displayProviders.length === 0 && (
											<div className="px-3 py-8 text-center text-[13px] text-neutral-400">暂无供应商配置</div>
										)}
									</div>
								</div>

								<div className="min-w-0 min-h-0 p-6 overflow-y-auto">
									{selected ? (
										<div className="space-y-6">
											<div>
												<div className="flex items-center gap-2">
													<h3 className="text-[18px] font-semibold text-neutral-900">{selected.id}</h3>
													{selected.default && (
														<span className="px-2 py-0.5 rounded-full bg-neutral-900 text-white text-[10px] font-medium">默认</span>
													)}
												</div>
												<div className="mt-3 flex flex-wrap gap-2">
													{selected.hasCredential && (
														<span className="px-2.5 py-1 rounded-lg bg-[#f2f1ee] text-[12px] text-neutral-600">
															已保存{selected.credentialType === "api_key" ? " API Key" : "凭据"}
														</span>
													)}
													{selected.hasCustomConfig && (
														<span className="px-2.5 py-1 rounded-lg bg-[#f2f1ee] text-[12px] text-neutral-600">models.json</span>
													)}
													{!selected.hasCredential && !selected.hasCustomConfig && (
														<span className="px-2.5 py-1 rounded-lg bg-[#f2f1ee] text-[12px] text-neutral-600">环境变量或运行时配置</span>
													)}
												</div>
											</div>

											<div>
												<div className="mb-2 flex items-center justify-between">
													<h4 className="text-[13px] font-semibold text-neutral-700">可用模型</h4>
													<span className="text-[12px] text-neutral-400">{selectedModels.length}</span>
												</div>
												<div className="max-h-56 overflow-y-auto rounded-xl border border-black/[0.07] divide-y divide-black/[0.06]">
													{selectedModels.map((model) => {
														const active = currentModel?.provider === model.provider && currentModel?.id === model.id;
														return (
															<button
																key={`${model.provider}::${model.id}`}
																type="button"
																onClick={() => void onSwitchModel(model.provider, model.id)}
																className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[#fafafa] transition-colors"
															>
																<span className="min-w-0 truncate text-[13px] text-neutral-700">{model.name || model.id}</span>
																{active && <span className="text-[11px] font-medium text-emerald-600">使用中</span>}
															</button>
														);
													})}
													{selectedModels.length === 0 && (
														<div className="px-3 py-6 text-center text-[12px] text-neutral-400">没有可用模型</div>
													)}
												</div>
											</div>

											<div className="pt-5 border-t border-black/[0.08]">
												<h4 className="text-[13px] font-semibold text-neutral-800">删除供应商</h4>
												<p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
											删除后，该供应商及其全部模型不会再出现在 ordis-ai 中。
												</p>
												{deleteError && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-600">{deleteError}</div>}
												<button
													type="button"
													disabled={!selected.deletable || deleting}
													onClick={() => void deleteSelectedProvider()}
													className="mt-4 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-rose-200 text-[13px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
												>
													<Trash2 className="w-4 h-4" />
													{deleting ? "正在删除…" : "删除供应商"}
												</button>
											</div>
										</div>
									) : (
										<div className="h-full flex items-center justify-center text-[13px] text-neutral-400">选择一个供应商查看详情</div>
									)}
								</div>
							</div>
						</div>
					) : (
						<div className="flex-1 overflow-y-auto px-8 py-7">
							<div className="max-w-3xl">
								<h3 className="text-[15px] font-semibold text-neutral-900">选择主题</h3>
								<p className="mt-1 text-[13px] text-neutral-500">当前仅提供 White，后续主题会在这里添加。</p>

								<div className="mt-6 w-64">
									<div className="relative overflow-hidden rounded-xl border-2 border-neutral-900 bg-white p-2 shadow-xs">
										<div className="h-32 overflow-hidden rounded-lg border border-black/[0.08] bg-white">
											<div className="flex h-full">
												<div className="w-16 border-r border-black/[0.06] bg-[#fafafa] p-2">
													<div className="h-1.5 w-8 rounded-full bg-neutral-300" />
													<div className="mt-3 h-5 rounded bg-[#ececec]" />
													<div className="mt-2 h-1.5 w-9 rounded-full bg-neutral-200" />
													<div className="mt-2 h-1.5 w-7 rounded-full bg-neutral-200" />
												</div>
												<div className="flex-1 p-3">
													<div className="h-2 w-20 rounded-full bg-neutral-300" />
													<div className="mt-5 h-1.5 w-24 rounded-full bg-neutral-200" />
													<div className="mt-2 h-1.5 w-16 rounded-full bg-neutral-200" />
													<div className="mt-7 h-7 rounded-lg border border-black/[0.08] bg-white shadow-xs" />
												</div>
											</div>
										</div>
										<div className="absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-white">
											<Check className="h-3 w-3" />
										</div>
									</div>
									<div className="mt-3 text-[14px] font-semibold text-neutral-900">White</div>
									<div className="mt-0.5 text-[12px] text-neutral-400">纯白简洁主题 · 当前使用</div>
								</div>
							</div>
						</div>
					)}
				</section>
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
								className="w-full p-2.5 bg-[#f7f7f8] rounded-lg text-xs text-neutral-800 focus:outline-hidden min-h-[140px]"
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

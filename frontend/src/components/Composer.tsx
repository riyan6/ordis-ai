import { useEffect, useMemo } from "react";
import {
	Plus,
	Folder,
	FolderPlus,
	ChevronUp,
	ArrowUp,
	Square,
	Check,
} from "lucide-react";
import type { PiModel } from "../pi-types";
import type { WorkspaceRecord } from "../use-pi-session";
import { usePopover } from "./usePopover";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function thinkingDisplayName(lvl: string): string {
	if (!lvl || lvl === "off") return "";
	if (lvl === "xhigh") return "XHigh";
	return lvl.charAt(0).toUpperCase() + lvl.slice(1);
}

const toolbarButton = (open: boolean) =>
	`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[13.5px] font-medium transition-colors duration-150 cursor-pointer select-none ${
		open ? "bg-[#e8e8e8] text-neutral-900" : "text-neutral-800 hover:text-neutral-950 hover:bg-[#e8e8e8]"
	}`;

const popoverPanel =
	"absolute bottom-full mb-2 left-0 z-50 bg-white border border-black/[0.08] rounded-2xl shadow-xl p-1.5 select-none animate-in fade-in zoom-in-95 duration-100";

function WorkspaceButton({
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
	const { open, toggle, close, ref } = usePopover();

	const activeWs = workspaces.find((w) => w.path === currentWorkspace);
	const displayName =
		activeWs?.name ||
		(currentWorkspace ? currentWorkspace.replace(/\\/g, "/").split("/").pop() : "选择工作区");

	return (
		<div className="relative inline-flex" ref={ref}>
			<button type="button" onClick={toggle} className={toolbarButton(open)} title="选择工作区">
				<Folder className="w-3.5 h-3.5 text-neutral-500" />
				<span className="truncate max-w-[140px]">{displayName}</span>
				<ChevronUp className="w-3.5 h-3.5 text-neutral-400" />
			</button>

			{open && (
				<div className={`${popoverPanel} w-72`}>
					<div className="px-2.5 py-1 text-xs font-semibold text-neutral-400">选择工作区</div>
					<div className="max-h-60 overflow-y-auto space-y-0.5 mt-0.5">
						{workspaces.map((w) => {
							const isSelected = w.path === currentWorkspace;
							return (
								<button
									key={w.id}
									type="button"
									onClick={() => {
										close();
										void onSelectWorkspace(w.path);
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
							<div className="px-3 py-2 text-xs text-neutral-400">暂无已注册工作区</div>
						)}
					</div>

					<div className="pt-1 mt-1 border-t border-black/[0.06]">
						<button
							type="button"
							onClick={() => {
								close();
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

function ModelButton({
	models,
	currentModel,
	onSwitchModel,
	onRefresh,
}: {
	models: PiModel[];
	currentModel?: { id: string; name?: string; provider?: string } | null;
	onSwitchModel: (provider: string, modelId: string) => Promise<void>;
	onRefresh?: () => void;
}) {
	const { open, toggle, close, ref } = usePopover(onRefresh);

	// Ctrl+/ (or Cmd+/) toggles the model popover.
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === "/") {
				e.preventDefault();
				toggle();
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [toggle]);

	// Drop exact provider+id duplicates; keep same-name models from
	// different providers but flag the collision so rows show the provider.
	const { displayModels, showProvider } = useMemo(() => {
		let source: Array<{ id: string; name: string; provider: string }> = models;
		if ((!source || source.length === 0) && currentModel) {
			source = [
				{
					id: currentModel.id,
					name: currentModel.name || currentModel.id,
					provider: currentModel.provider || "",
				},
			];
		}
		const seen = new Set<string>();
		const deduped: Array<{ id: string; name: string; provider: string }> = [];
		for (const m of source) {
			const key = `${m.provider}::${m.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			deduped.push(m);
		}
		const nameCount = new Map<string, number>();
		for (const m of deduped) nameCount.set(m.name, (nameCount.get(m.name) ?? 0) + 1);
		let collision = false;
		for (const c of nameCount.values()) {
			if (c > 1) {
				collision = true;
				break;
			}
		}
		return { displayModels: deduped, showProvider: collision };
	}, [models, currentModel]);

	return (
		<div className="relative inline-flex" ref={ref}>
			<button type="button" onClick={toggle} className={toolbarButton(open)} title="选择模型 (Ctrl+/)">
				<span className="truncate max-w-[220px]">{currentModel?.name || "选择模型"}</span>
				<ChevronUp className="w-3.5 h-3.5 text-neutral-400" />
			</button>

			{open && (
				<div className={`${popoverPanel} w-72 max-h-80 overflow-y-auto`}>
					<div className="px-2.5 py-1 text-xs font-semibold text-neutral-400">模型</div>
					<div className="space-y-0.5 mt-0.5">
						{displayModels.map((m) => {
							const isSelected =
								!!currentModel && currentModel.id === m.id && currentModel.provider === m.provider;
							return (
								<button
									key={`${m.provider}::${m.id}`}
									type="button"
									onClick={() => {
										close();
										void onSwitchModel(m.provider, m.id);
									}}
									className={`w-full text-left px-3 py-2 rounded-xl text-[13.5px] flex items-center justify-between transition-colors ${
										isSelected
											? "bg-[#f0f0f0] text-neutral-900 font-medium"
											: "text-neutral-700 hover:bg-[#f5f5f5] hover:text-neutral-900"
									}`}
								>
									<div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
										<span className="truncate">{m.name}</span>
										{showProvider && (
											<span className="text-[10px] text-neutral-400 flex-shrink-0">
												{m.provider}
											</span>
										)}
									</div>
									{isSelected && <Check className="w-3.5 h-3.5 text-neutral-800 flex-shrink-0" />}
								</button>
							);
						})}

						{displayModels.length === 0 && (
							<div className="px-3 py-2 text-xs text-neutral-400">暂无可用模型</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function ThinkingButton({
	currentLevel,
	onChangeThinking,
}: {
	currentLevel: string;
	onChangeThinking: (level: string) => Promise<void>;
}) {
	const { open, toggle, close, ref } = usePopover();

	return (
		<div className="relative inline-flex" ref={ref}>
			<button type="button" onClick={toggle} className={toolbarButton(open)} title="思考级别">
				<span>{thinkingDisplayName(currentLevel) || "思考"}</span>
				<ChevronUp className="w-3.5 h-3.5 text-neutral-400" />
			</button>

			{open && (
				<div className={`${popoverPanel} w-36`}>
					<div className="px-2.5 py-1 text-xs font-semibold text-neutral-400">思考级别</div>
					<div className="space-y-0.5 mt-0.5">
						{THINKING_LEVELS.map((lvl) => {
							const isSelected = currentLevel === lvl;
							return (
								<button
									key={lvl}
									type="button"
									onClick={() => {
										close();
										void onChangeThinking(lvl);
									}}
									className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors ${
										isSelected
											? "bg-[#f0f0f0] font-medium text-neutral-900"
											: "text-neutral-600 hover:bg-[#f0f0f0] hover:text-neutral-900"
									}`}
								>
									<span>{thinkingDisplayName(lvl) || "Off"}</span>
									{isSelected && <Check className="w-3 h-3 text-neutral-800" />}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}

export interface ComposerProps {
	variant: "welcome" | "chat";
	input: string;
	onInputChange: (value: string) => void;
	onSubmit: () => void;
	onKeyDown: (e: React.KeyboardEvent) => void;
	inputRef: React.RefObject<HTMLTextAreaElement>;
	agentBusy: boolean;
	onAbort: () => void;
	models: PiModel[];
	currentModel?: { id: string; name?: string; provider?: string } | null;
	currentThinkingLevel: string;
	onSwitchModel: (provider: string, modelId: string) => Promise<void>;
	onChangeThinking: (level: string) => Promise<void>;
	onRefreshModels?: () => void;
	workspaces: WorkspaceRecord[];
	currentWorkspace: string;
	onSelectWorkspace: (path: string) => Promise<void>;
	onAddWorkspace: () => Promise<void>;
}

export function Composer({
	variant,
	input,
	onInputChange,
	onSubmit,
	onKeyDown,
	inputRef,
	agentBusy,
	onAbort,
	models,
	currentModel,
	currentThinkingLevel,
	onSwitchModel,
	onChangeThinking,
	onRefreshModels,
	workspaces,
	currentWorkspace,
	onSelectWorkspace,
	onAddWorkspace,
}: ComposerProps) {
	const isWelcome = variant === "welcome";
	const maxHeight = 160;

	return (
		<div className="bg-white border border-black/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.04)] rounded-2xl p-3 sm:p-4 space-y-1.5">
			<textarea
				ref={inputRef}
				value={input}
				onChange={(e) => {
					onInputChange(e.target.value);
					e.target.style.height = "auto";
					e.target.style.height = `${Math.min(e.target.scrollHeight, maxHeight)}px`;
				}}
				onKeyDown={onKeyDown}
				placeholder={
					isWelcome
						? "随心输入需求或指令，让 Pi 协助您编写、分析或重构代码..."
						: "随心输入 (Shift+Enter 换行)..."
				}
				className={`w-full bg-transparent text-neutral-900 placeholder:text-neutral-400 text-[15px] focus:outline-hidden resize-none leading-relaxed border-0 outline-none ring-0 shadow-none max-h-40 ${
					isWelcome ? "min-h-[64px]" : "min-h-[40px]"
				}`}
				rows={isWelcome ? 2 : 1}
			/>

			<div className="flex items-center justify-between pt-1">
				<div className="flex items-center gap-1.5 min-w-0">
					<button
						type="button"
						className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-[#f0f0f0] transition-colors"
						title="添加附件或扩展"
					>
						<Plus className="w-4 h-4" />
					</button>

					{isWelcome && (
						<WorkspaceButton
							workspaces={workspaces}
							currentWorkspace={currentWorkspace}
							onSelectWorkspace={onSelectWorkspace}
							onAddWorkspace={onAddWorkspace}
						/>
					)}

					<ModelButton
						models={models}
						currentModel={currentModel}
						onSwitchModel={onSwitchModel}
						onRefresh={onRefreshModels}
					/>

					<ThinkingButton
						currentLevel={currentThinkingLevel}
						onChangeThinking={onChangeThinking}
					/>
				</div>

				{agentBusy ? (
					<button
						onClick={onAbort}
						className="w-8 h-8 rounded-full bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white flex items-center justify-center transition-colors duration-150 wails-no-drag shadow-xs cursor-pointer flex-shrink-0"
						title="停止生成 (Esc)"
					>
						<Square className="w-3.5 h-3.5 fill-white text-white" />
					</button>
				) : (
					<button
						onClick={onSubmit}
						disabled={!input.trim()}
						className="w-8 h-8 rounded-full bg-neutral-900 hover:bg-neutral-800 disabled:opacity-20 text-white flex items-center justify-center transition-colors duration-150 disabled:cursor-not-allowed wails-no-drag shadow-xs flex-shrink-0"
						title="发送 (Enter)"
					>
						<ArrowUp className="w-4 h-4" />
					</button>
				)}
			</div>
		</div>
	);
}

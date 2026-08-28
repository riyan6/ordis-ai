/**
 * Minimalist message & turn renderer inspired by Claude Code / Codex desktop aesthetics:
 * - Full-width bottom-bordered activity status bar (working... Xs / 用时 Xm Ys)
 * - Complete encapsulation of all intermediate turn steps (thinking, read, bash, tool results)
 * - Clean markdown response rendering below the activity divider
 */
import { memo, useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	ChevronRight,
	Check,
	Copy,
	Terminal,
	FileText,
	Search,
	Wrench,
	Code2,
} from "lucide-react";
import type { ContentBlock, ToolCallBlock } from "../pi-types";
import type { UiMessage } from "../use-pi-session";

export type ActivityItem =
	| { kind: "thinking"; text: string }
	| { kind: "toolCall"; call: ToolCallBlock }
	| { kind: "toolResult"; toolName: string; isError?: boolean }
	| { kind: "bash"; content?: ContentBlock[] };

export interface ConversationTurn {
	id: string;
	userMessage?: UiMessage;
	activities: ActivityItem[];
	textBlocks: ContentBlock[];
	streaming?: boolean;
}

/**
 * Group flat messages into clean user-agent conversation turns
 */
export function groupMessagesIntoTurns(messages: UiMessage[], agentBusy: boolean): ConversationTurn[] {
	const turns: ConversationTurn[] = [];
	let currentTurn: ConversationTurn | null = null;

	for (const msg of messages) {
		if (msg.role === "user") {
			currentTurn = {
				id: msg.id,
				userMessage: msg,
				activities: [],
				textBlocks: [],
				streaming: false,
			};
			turns.push(currentTurn);
			continue;
		}

		if (!currentTurn) {
			currentTurn = {
				id: msg.id,
				activities: [],
				textBlocks: [],
				streaming: false,
			};
			turns.push(currentTurn);
		}

		if (msg.streaming) {
			currentTurn.streaming = true;
		}

		if (msg.role === "toolResult") {
			currentTurn.activities.push({
				kind: "toolResult",
				toolName: msg.toolName || "工具执行",
				isError: msg.isError,
			});
		} else if (msg.role === "bash") {
			currentTurn.activities.push({
				kind: "bash",
				content: msg.content,
			});
		} else if (msg.role === "assistant") {
			for (const b of msg.content) {
				if (b.type === "thinking") {
					currentTurn.activities.push({
						kind: "thinking",
						text: b.thinking,
					});
				} else if (b.type === "toolCall") {
					currentTurn.activities.push({
						kind: "toolCall",
						call: b,
					});
				} else if (b.type === "text") {
					currentTurn.textBlocks.push(b);
				}
			}
		} else {
			for (const b of msg.content) {
				if (b.type === "text") {
					currentTurn.textBlocks.push(b);
				}
			}
		}
	}

	if (agentBusy && turns.length > 0 && !turns[turns.length - 1].streaming) {
		turns[turns.length - 1].streaming = true;
	}

	return turns;
}

/**
 * Conversation Turn View: renders user prompt + collapsible turn activity + final reply
 */
export const ConversationTurnView = memo(function ConversationTurnView({
	turn,
}: {
	turn: ConversationTurn;
}) {
	const hasActivity = turn.activities.length > 0 || (turn.streaming && turn.textBlocks.length === 0);

	return (
		<div className="space-y-4">
			{turn.userMessage && (
				<div className="flex justify-end my-3 group">
					<div className="bg-[#f4f4f5] hover:bg-[#ebebeb] text-[#1a1a1a] rounded-2xl rounded-tr-xs px-4 py-2.5 max-w-[85%] sm:max-w-[75%] transition-colors duration-150">
						<div className="prose-custom text-[15px] leading-relaxed">
							{renderTextBlocks(turn.userMessage.content, false)}
						</div>
					</div>
				</div>
			)}

			{(hasActivity || turn.textBlocks.length > 0) && (
				<div className="my-3 text-[#1a1a1a] space-y-2">
					{hasActivity && (
						<ReasoningActivitySection
							activities={turn.activities}
							streaming={Boolean(turn.streaming)}
						/>
					)}
					{renderTextBlocks(turn.textBlocks, Boolean(turn.streaming))}
					{turn.streaming && turn.textBlocks.length === 0 && turn.activities.length === 0 && (
						<WorkingIndicator />
					)}
				</div>
			)}
		</div>
	);
});

/**
 * Single Message renderer (fallback compatibility)
 */
export const Message = memo(function Message({
	message,
	streaming = false,
}: {
	message: UiMessage;
	streaming?: boolean;
}) {
	switch (message.role) {
		case "user":
			return (
				<div className="flex justify-end my-3 group">
					<div className="bg-[#f4f4f5] hover:bg-[#ebebeb] text-[#1a1a1a] rounded-2xl rounded-tr-xs px-4 py-2.5 max-w-[85%] sm:max-w-[75%] transition-colors duration-150">
						<div className="prose-custom text-[15px] leading-relaxed">
							{renderTextBlocks(message.content, false)}
						</div>
					</div>
				</div>
			);
		case "assistant": {
			const activities: ActivityItem[] = [];
			const textBlocks: ContentBlock[] = [];
			for (const b of message.content) {
				if (b.type === "thinking") {
					activities.push({ kind: "thinking", text: b.thinking });
				} else if (b.type === "toolCall") {
					activities.push({ kind: "toolCall", call: b });
				} else if (b.type === "text") {
					textBlocks.push(b);
				}
			}
			const hasActivity = activities.length > 0 || (streaming && textBlocks.length === 0);

			return (
				<div className="my-3 text-[#1a1a1a] space-y-2">
					{hasActivity && (
						<ReasoningActivitySection
							activities={activities}
							streaming={streaming}
						/>
					)}
					{renderTextBlocks(textBlocks, streaming)}
					{streaming && textBlocks.length === 0 && activities.length === 0 && (
						<WorkingIndicator />
					)}
				</div>
			);
		}
		case "toolResult":
			return (
				<div className="flex items-center gap-1.5 my-1 text-[13px] text-neutral-500">
					<span
						className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
							message.isError ? "bg-rose-500" : "bg-neutral-400"
						}`}
					/>
					<span className="font-medium text-neutral-700">
						{message.toolName || "工具执行"}
					</span>
					<span className="text-neutral-400 text-xs">
						{message.isError ? "执行失败" : "执行完成"}
					</span>
				</div>
			);
		case "bash":
			return (
				<div className="my-2 pl-3.5 border-l-2 border-neutral-200 text-[13px] text-neutral-800 overflow-x-auto">
					<div className="flex items-center gap-1.5 text-neutral-400 text-xs mb-1">
						<Terminal className="w-3.5 h-3.5 text-neutral-400" />
						<span>终端输出</span>
					</div>
					<pre className="m-0 whitespace-pre-wrap word-break-all font-mono text-[13px] leading-relaxed text-neutral-700">
						{blocksToText(message.content)}
					</pre>
				</div>
			);
		default:
			return (
				<div className="my-2 text-neutral-400 text-[13px] italic">
					{renderTextBlocks(message.content, false)}
				</div>
			);
	}
});

/**
 * Animated Working indicator (working. -> working.. -> working...)
 */
export function WorkingIndicator() {
	const [dots, setDots] = useState(".");

	useEffect(() => {
		const timer = setInterval(() => {
			setDots((prev) => {
				if (prev === ".") return "..";
				if (prev === "..") return "...";
				return ".";
			});
		}, 400);
		return () => clearInterval(timer);
	}, []);

	return (
		<div className="flex items-center text-[#6e6e6e] text-[14px] font-normal select-none py-1 animate-in fade-in duration-150">
			<span>working</span>
			<span className="w-5 inline-block text-left">{dots}</span>
		</div>
	);
}

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${Math.max(1, seconds)}s`;
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}m ${s}s`;
}

/**
 * Full-width, bottom-bordered activity block controlling thinking, tools, and results
 */
function ReasoningActivitySection({
	activities,
	streaming,
}: {
	activities: ActivityItem[];
	streaming: boolean;
}) {
	const [open, setOpen] = useState(streaming);
	const [elapsed, setElapsed] = useState(0);
	const [finalDuration, setFinalDuration] = useState<number | null>(null);
	const startTimeRef = useRef<number>(Date.now());
	const prevStreamingRef = useRef(streaming);

	useEffect(() => {
		if (prevStreamingRef.current && !streaming) {
			// Finished streaming -> Collapse by default & freeze duration
			setOpen(false);
			const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
			setFinalDuration(duration);
		} else if (!prevStreamingRef.current && streaming) {
			// Started streaming -> Expand & reset timer
			setOpen(true);
			startTimeRef.current = Date.now();
			setElapsed(0);
			setFinalDuration(null);
		}
		prevStreamingRef.current = streaming;
	}, [streaming]);

	useEffect(() => {
		if (!streaming) return;
		const timer = setInterval(() => {
			setElapsed(Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000)));
		}, 1000);
		return () => clearInterval(timer);
	}, [streaming]);

	const durationText = streaming
		? formatDuration(elapsed)
		: formatDuration(finalDuration ?? (elapsed > 0 ? elapsed : 1));

	return (
		<div className="w-full my-2 select-none">
			{/* Full-width status bar with bottom border, left-aligned text */}
			<div className="w-full border-b border-black/[0.08] pb-2">
				<button
					type="button"
					onClick={() => setOpen(!open)}
					className="w-full flex items-center justify-between py-1 text-left group cursor-pointer"
				>
					<div className="flex items-center gap-2 text-[13px]">
						<ChevronRight
							className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-200 ${
								open ? "rotate-90" : ""
							}`}
						/>
						{streaming ? (
							<div className="flex items-center gap-1.5 font-medium text-neutral-700">
								<span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse" />
								<span>working... {durationText}</span>
							</div>
						) : (
							<span className="font-normal text-neutral-600">用时 {durationText}</span>
						)}
					</div>
					<div className="text-[12px] text-neutral-400">
						{activities.length > 0 && `${activities.length} 个步骤`}
					</div>
				</button>

				{open && (
					<div className="mt-2.5 mb-1 pl-3.5 border-l-2 border-neutral-200 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
						{activities.map((item, i) => {
							if (item.kind === "thinking") {
								return (
									<div
										key={i}
										className="text-neutral-600 text-[13px] leading-relaxed max-h-72 overflow-y-auto whitespace-pre-wrap select-text font-sans"
									>
										<div className="text-neutral-400 text-xs mb-1 font-medium select-none">思考过程：</div>
										<div>{item.text || "思考中..."}</div>
										{streaming && i === activities.length - 1 && (
											<span className="streaming-caret ml-1 opacity-60" />
										)}
									</div>
								);
							}
							if (item.kind === "toolCall") {
								return <ToolCallItem key={i} call={item.call} />;
							}
							if (item.kind === "toolResult") {
								return (
									<div key={i} className="flex items-center gap-1.5 py-0.5 text-[13px] text-neutral-500">
										<span
											className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
												item.isError ? "bg-rose-500" : "bg-neutral-400"
											}`}
										/>
										<span className="font-medium text-neutral-700">
											{item.toolName}
										</span>
										<span className="text-neutral-400 text-xs">
											{item.isError ? "执行失败" : "执行完成"}
										</span>
									</div>
								);
							}
							if (item.kind === "bash") {
								return (
									<div key={i} className="my-1 text-[13px] text-neutral-800 overflow-x-auto">
										<div className="flex items-center gap-1.5 text-neutral-400 text-xs mb-1">
											<Terminal className="w-3.5 h-3.5 text-neutral-400" />
											<span>终端执行</span>
										</div>
										<pre className="m-0 whitespace-pre-wrap word-break-all font-mono text-[13px] leading-relaxed text-neutral-700">
											{blocksToText(item.content ?? [])}
										</pre>
									</div>
								);
							}
							return null;
						})}
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * Flat, minimalist Tool Call item without background colors
 */
function ToolCallItem({ call }: { call: ToolCallBlock }) {
	const [expanded, setExpanded] = useState(false);
	const name = call.name;
	const summary = summarizeArgs(call.arguments ?? {});
	const argText = JSON.stringify(call.arguments ?? {}, null, 2);

	const getToolIcon = () => {
		switch (name) {
			case "bash":
			case "exec":
			case "terminal":
				return <Terminal className="w-3.5 h-3.5 text-neutral-400" />;
			case "read":
			case "read_file":
			case "write":
			case "write_to_file":
			case "edit":
			case "replace_file_content":
				return <FileText className="w-3.5 h-3.5 text-neutral-400" />;
			case "grep":
			case "grep_search":
			case "glob":
			case "find_by_name":
			case "search":
			case "web_search":
				return <Search className="w-3.5 h-3.5 text-neutral-400" />;
			default:
				return <Wrench className="w-3.5 h-3.5 text-neutral-400" />;
		}
	};

	return (
		<div className="text-[13px] select-none">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-black/[0.03] transition-colors duration-150 text-left group cursor-pointer"
			>
				<ChevronRight
					className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-150 ${
						expanded ? "rotate-90" : ""
					}`}
				/>
				<div className="flex items-center gap-1.5 min-w-0 flex-1">
					{getToolIcon()}
					<span className="font-mono font-medium text-neutral-700">{name}</span>
					{summary && (
						<span className="font-mono text-[12.5px] text-neutral-400 truncate flex-1">
							{summary}
						</span>
					)}
				</div>
			</button>

			{expanded && (
				<div className="mt-1 pl-3.5 border-l border-neutral-200 text-neutral-700 font-mono text-[12.5px] overflow-x-auto max-h-56 select-text">
					<div className="text-neutral-400 text-xs mb-1 font-sans">参数:</div>
					<pre className="m-0 whitespace-pre text-neutral-600">{argText}</pre>
				</div>
			)}
		</div>
	);
}

function renderTextBlocks(blocks: ContentBlock[], streaming: boolean) {
	if (blocks.length === 0) {
		return null;
	}

	return blocks.map((b, i) => {
		if (b.type !== "text") return null;
		const isActive = streaming && i === blocks.length - 1 && b.text.length > 0;
		return (
			<div key={i} className="prose-custom text-[15px]">
				<ReactMarkdown
					remarkPlugins={[remarkGfm]}
					components={{
						code({ className, children, ...props }) {
							const match = /language-(\w+)/.exec(className || "");
							const isInline = !match && !String(children).includes("\n");
							if (isInline) {
								return (
									<code className={className} {...props}>
										{children}
									</code>
								);
							}
							return (
								<CodeBlock language={match ? match[1] : ""}>
									{String(children).replace(/\n$/, "")}
								</CodeBlock>
							);
						},
					}}
				>
					{b.text}
				</ReactMarkdown>
				{isActive && <span className="streaming-caret" />}
			</div>
		);
	});
}

/**
 * Code block with language tag and copy-to-clipboard button
 */
function CodeBlock({ language, children }: { language: string; children: string }) {
	const [copied, setCopied] = useState(false);

	const onCopy = useCallback(() => {
		navigator.clipboard.writeText(children);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [children]);

	return (
		<div className="my-3 rounded-lg overflow-hidden bg-[#18181b] text-neutral-200 group">
			<div className="flex items-center justify-between px-3.5 py-1.5 bg-[#202023] text-xs text-neutral-400 select-none">
				<div className="flex items-center gap-1.5 font-mono">
					<Code2 className="w-3.5 h-3.5 text-neutral-500" />
					<span>{language || "code"}</span>
				</div>
				<button
					type="button"
					onClick={onCopy}
					className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#2e2e33] text-neutral-400 hover:text-neutral-200 transition-colors duration-150 text-xs cursor-pointer"
				>
					{copied ? (
						<>
							<Check className="w-3.5 h-3.5 text-neutral-200" />
							<span className="text-neutral-200">已复制</span>
						</>
					) : (
						<>
							<Copy className="w-3.5 h-3.5" />
							<span>复制</span>
						</>
					)}
				</button>
			</div>
			<pre className="p-3.5 m-0 text-neutral-200 font-mono text-[13px] overflow-x-auto leading-relaxed">
				<code>{children}</code>
			</pre>
		</div>
	);
}

function summarizeArgs(args: Record<string, unknown>): string {
	const v =
		args["file_path"] ??
		args["path"] ??
		args["command"] ??
		args["pattern"] ??
		args["query"] ??
		args["target_file"];
	if (typeof v === "string") return v.length > 70 ? v.slice(0, 70) + "…" : v;
	return "";
}

function blocksToText(blocks: ContentBlock[]): string {
	return blocks
		.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
		.map((b) => b.text)
		.join("");
}

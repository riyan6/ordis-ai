/**
 * Modern white-theme message renderer inspired by Tether & Linear:
 * - Clean Markdown typography with copyable code blocks
 * - Tether-style expandable Thinking capsule
 * - Workbench Tool Call cards with status indicators
 */
import { memo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	Sparkles,
	ChevronRight,
	ChevronDown,
	Check,
	Copy,
	Terminal,
	FileText,
	Search,
	Wrench,
	AlertCircle,
	CheckCircle2,
	Loader2,
	CornerDownRight,
	Code2
} from "lucide-react";
import type { ContentBlock, ToolCallBlock } from "../pi-types";
import type { UiMessage } from "../use-pi-session";

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
				<div className="flex justify-end my-3.5 group">
					<div className="bg-slate-100 hover:bg-slate-200/80 text-slate-900 border border-slate-200/80 rounded-2xl rounded-tr-md px-4 py-2.5 max-w-[85%] sm:max-w-[75%] shadow-xs transition-colors">
						<div className="prose-custom text-[13.5px] leading-relaxed">
							{renderBlocks(message.content, false)}
						</div>
					</div>
				</div>
			);

		case "assistant":
			return (
				<div className="flex gap-3.5 my-4 group">
					<div className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[11px] font-semibold flex-shrink-0 mt-0.5 shadow-xs">
						π
					</div>
					<div className="flex-1 min-w-0 space-y-2">
						{renderBlocks(message.content, streaming)}
					</div>
				</div>
			);

		case "toolResult":
			return (
				<div className="flex items-center gap-2 pl-9 my-1.5">
					<div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100/90 border border-slate-200 text-slate-600 text-xs">
						<CornerDownRight className="w-3.5 h-3.5 text-slate-400" />
						<span
							className={`w-1.5 h-1.5 rounded-full ${
								message.isError ? "bg-rose-500" : "bg-emerald-500"
							}`}
						/>
						<span className="font-mono font-medium text-[11.5px] text-slate-700">
							{message.toolName || "工具执行"}
						</span>
						<span className="text-[11px] text-slate-400">
							{message.isError ? "执行失败" : "执行完毕"}
						</span>
					</div>
				</div>
			);

		case "bash":
			return (
				<div className="pl-9 my-2">
					<div className="bg-slate-900 text-slate-200 border border-slate-800 rounded-xl p-3 font-mono text-xs overflow-x-auto shadow-xs">
						<div className="flex items-center gap-1.5 text-slate-400 text-[11px] mb-1.5 pb-1 border-b border-slate-800/80">
							<Terminal className="w-3.5 h-3.5" />
							<span>终端输出</span>
						</div>
						<pre className="m-0 whitespace-pre-wrap word-break-all text-[12px] leading-relaxed">
							{blocksToText(message.content)}
						</pre>
					</div>
				</div>
			);

		default:
			return (
				<div className="pl-9 my-2 text-slate-500 text-xs italic">
					{renderBlocks(message.content, false)}
				</div>
			);
	}
});

function renderBlocks(blocks: ContentBlock[], streaming: boolean) {
	if (blocks.length === 0) {
		return streaming ? (
			<div className="flex items-center gap-1 py-2 px-1">
				<span className="typing-dot" />
				<span className="typing-dot" />
				<span className="typing-dot" />
			</div>
		) : null;
	}

	return blocks.map((b, i) => {
		if (b.type === "text") {
			const isActive = streaming && i === blocks.length - 1 && b.text.length > 0;
			return (
				<div key={i} className="prose-custom text-[14px]">
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
		}

		if (b.type === "thinking") {
			return (
				<ThinkingCapsule
					key={i}
					text={b.thinking}
					isStreaming={streaming && i === blocks.length - 1}
				/>
			);
		}

		if (b.type === "toolCall") {
			return <ToolCallCard key={i} call={b} />;
		}

		return null;
	});
}

/**
 * Tether-inspired collapsible thinking timeline capsule
 */
function ThinkingCapsule({ text, isStreaming }: { text: string; isStreaming: boolean }) {
	const [open, setOpen] = useState(isStreaming);

	return (
		<div className="my-2 select-none">
			<button
				onClick={() => setOpen(!open)}
				className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition-all ${
					open
						? "bg-slate-100/90 border-slate-300/80 text-slate-800 shadow-xs"
						: "bg-slate-50 hover:bg-slate-100 border-slate-200/80 text-slate-600"
				}`}
			>
				<Sparkles
					className={`w-3.5 h-3.5 ${
						isStreaming ? "text-amber-500 animate-spin" : "text-slate-400"
					}`}
				/>
				<span className="font-medium">
					{isStreaming ? "正在深度思考..." : "思考过程"}
				</span>
				{isStreaming && (
					<span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
				)}
				{open ? (
					<ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
				) : (
					<ChevronRight className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
				)}
			</button>

			{open && (
				<div className="mt-2 p-3 bg-slate-50/90 border border-slate-200/80 rounded-xl text-slate-600 font-mono text-xs leading-relaxed max-h-72 overflow-y-auto whitespace-pre-wrap select-text shadow-inner">
					{text || "思考中..."}
					{isStreaming && <span className="streaming-caret ml-1 opacity-70" />}
				</div>
			)}
		</div>
	);
}

/**
 * Modern clean Tool Call Card with status indicators
 */
function ToolCallCard({ call }: { call: ToolCallBlock }) {
	const [open, setOpen] = useState(false);
	const name = call.name;
	const summary = summarizeArgs(call.arguments ?? {});
	const argText = JSON.stringify(call.arguments ?? {}, null, 2);

	const getToolIcon = () => {
		switch (name) {
			case "bash":
			case "exec":
				return <Terminal className="w-3.5 h-3.5 text-slate-700" />;
			case "read_file":
			case "write_to_file":
			case "replace_file_content":
				return <FileText className="w-3.5 h-3.5 text-blue-600" />;
			case "grep_search":
			case "find_by_name":
				return <Search className="w-3.5 h-3.5 text-amber-600" />;
			default:
				return <Wrench className="w-3.5 h-3.5 text-slate-600" />;
		}
	};

	return (
		<div className="my-2 border border-slate-200 bg-white rounded-xl overflow-hidden shadow-xs hover:border-slate-300 transition-all text-xs">
			<button
				onClick={() => setOpen(!open)}
				className="w-full flex items-center gap-2.5 px-3 py-2 bg-slate-50/70 hover:bg-slate-100/60 transition-colors text-left select-none"
			>
				<div className="p-1 rounded-md bg-white border border-slate-200 shadow-2xs">
					{getToolIcon()}
				</div>
				<span className="font-mono font-semibold text-slate-800">{name}</span>
				{summary && (
					<span className="text-slate-500 font-mono text-[11px] truncate flex-1 max-w-sm">
						{summary}
					</span>
				)}
				<div className="ml-auto flex items-center gap-1.5 text-slate-400">
					{open ? (
						<ChevronDown className="w-3.5 h-3.5" />
					) : (
						<ChevronRight className="w-3.5 h-3.5" />
					)}
				</div>
			</button>

			{open && (
				<div className="border-t border-slate-100 bg-slate-950 p-3 text-slate-200 font-mono text-[11px] overflow-x-auto max-h-56">
					<div className="text-slate-400 text-[10px] mb-1 font-sans">参数调用:</div>
					<pre className="m-0 whitespace-pre">{argText}</pre>
				</div>
			)}
		</div>
	);
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
		<div className="my-3 rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-xs group">
			<div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-900 border-b border-slate-800 text-[11.5px] text-slate-400 select-none">
				<div className="flex items-center gap-1.5 font-mono font-medium">
					<Code2 className="w-3.5 h-3.5 text-slate-500" />
					<span>{language || "code"}</span>
				</div>
				<button
					onClick={onCopy}
					className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors text-[11px]"
				>
					{copied ? (
						<>
							<Check className="w-3 h-3 text-emerald-400" />
							<span className="text-emerald-400">已复制</span>
						</>
					) : (
						<>
							<Copy className="w-3 h-3" />
							<span>复制</span>
						</>
					)}
				</button>
			</div>
			<pre className="p-3.5 m-0 text-slate-200 font-mono text-[12px] overflow-x-auto leading-relaxed">
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
	if (typeof v === "string") return v.length > 60 ? v.slice(0, 60) + "…" : v;
	return "";
}

function blocksToText(blocks: ContentBlock[]): string {
	return blocks
		.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
		.map((b) => b.text)
		.join("");
}


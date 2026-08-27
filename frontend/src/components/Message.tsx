/**
 * Minimalist message renderer inspired by Claude Code / modern desktop CLI aesthetics:
 * - Pure, quiet typography with clean copyable code blocks
 * - Minimalist expandable thinking process
 * - Lightweight, flat tool call & terminal output blocks
 * - Smooth working indicator with dot animation
 */
import { memo, useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	ChevronRight,
	ChevronDown,
	Check,
	Copy,
	Terminal,
	FileText,
	Search,
	Wrench,
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
				<div className="flex justify-end my-3 group">
					<div className="bg-[#f4f4f5] hover:bg-[#ebebeb] text-[#1a1a1a] rounded-2xl rounded-tr-xs px-4 py-2.5 max-w-[85%] sm:max-w-[75%] transition-colors duration-150">
						<div className="prose-custom text-[15px] leading-relaxed">
							{renderBlocks(message.content, false)}
						</div>
					</div>
				</div>
			);

		case "assistant":
			return (
				<div className="my-3 text-[#1a1a1a] space-y-2">
					{renderBlocks(message.content, streaming)}
					{streaming && <WorkingIndicator />}
				</div>
			);

		case "toolResult":
			return (
				<div className="flex items-center gap-1.5 my-1 text-[13px] font-mono text-neutral-500">
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
				<div className="my-2 rounded-lg bg-[#f7f7f8] p-3 font-mono text-[13px] text-neutral-800 overflow-x-auto">
					<div className="flex items-center gap-1.5 text-neutral-400 text-xs mb-1.5">
						<Terminal className="w-3.5 h-3.5 text-neutral-400" />
						<span>终端输出</span>
					</div>
					<pre className="m-0 whitespace-pre-wrap word-break-all text-[13px] leading-relaxed text-neutral-700">
						{blocksToText(message.content)}
					</pre>
				</div>
			);

		default:
			return (
				<div className="my-2 text-neutral-400 text-[13px] italic">
					{renderBlocks(message.content, false)}
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

function renderBlocks(blocks: ContentBlock[], streaming: boolean) {
	if (blocks.length === 0) {
		return null;
	}

	return blocks.map((b, i) => {
		if (b.type === "text") {
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
 * Minimalist collapsible thinking section
 */
function ThinkingCapsule({ text, isStreaming }: { text: string; isStreaming: boolean }) {
	const [open, setOpen] = useState(isStreaming);

	return (
		<div className="my-1.5 select-none">
			<button
				onClick={() => setOpen(!open)}
				className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[13px] text-neutral-500 hover:text-neutral-900 hover:bg-[#f5f5f5] transition-colors duration-150"
			>
				<ChevronRight
					className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-150 ${
						open ? "rotate-90" : ""
					}`}
				/>
				<span className="font-medium">
					{isStreaming ? "思考中..." : "思考过程"}
				</span>
				{isStreaming && (
					<span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse" />
				)}
			</button>

			{open && (
				<div className="mt-1 p-3 bg-[#f7f7f8] rounded-md text-neutral-600 font-mono text-[13px] leading-relaxed max-h-72 overflow-y-auto whitespace-pre-wrap select-text">
					{text || "思考中..."}
					{isStreaming && <span className="streaming-caret ml-1 opacity-60" />}
				</div>
			)}
		</div>
	);
}

/**
 * Flat, minimalist Tool Call item (matching Claude Code style)
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
				return <Terminal className="w-3.5 h-3.5 text-neutral-500" />;
			case "read_file":
			case "write_to_file":
			case "replace_file_content":
				return <FileText className="w-3.5 h-3.5 text-neutral-500" />;
			case "grep_search":
			case "find_by_name":
				return <Search className="w-3.5 h-3.5 text-neutral-500" />;
			default:
				return <Wrench className="w-3.5 h-3.5 text-neutral-500" />;
		}
	};

	return (
		<div className="my-1.5 text-[13px] select-none">
			<button
				onClick={() => setOpen(!open)}
				className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#f7f7f8] hover:bg-[#f0f0f1] transition-colors duration-150 text-left group"
			>
				<ChevronRight
					className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-150 ${
						open ? "rotate-90" : ""
					}`}
				/>
				<div className="flex items-center gap-1.5 min-w-0 flex-1">
					{getToolIcon()}
					<span className="font-mono font-medium text-neutral-800">{name}</span>
					{summary && (
						<span className="font-mono text-[12.5px] text-neutral-500 truncate flex-1">
							{summary}
						</span>
					)}
				</div>
			</button>

			{open && (
				<div className="mt-1 p-3 bg-[#f7f7f8] rounded-md text-neutral-700 font-mono text-[12.5px] overflow-x-auto max-h-56 select-text">
					<div className="text-neutral-400 text-xs mb-1 font-sans">参数:</div>
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
		<div className="my-3 rounded-lg overflow-hidden bg-[#18181b] text-neutral-200 group">
			<div className="flex items-center justify-between px-3.5 py-1.5 bg-[#202023] text-xs text-neutral-400 select-none">
				<div className="flex items-center gap-1.5 font-mono">
					<Code2 className="w-3.5 h-3.5 text-neutral-500" />
					<span>{language || "code"}</span>
				</div>
				<button
					onClick={onCopy}
					className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#2e2e33] text-neutral-400 hover:text-neutral-200 transition-colors duration-150 text-xs"
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

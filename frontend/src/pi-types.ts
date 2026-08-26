/**
 * Pi RPC protocol types (subset used by the desktop UI).
 * Mirrors packages/coding-agent/docs/rpc.md from the pi repo.
 */

export interface PiModel {
	id: string;
	name: string;
	api: string;
	provider: string;
	baseUrl?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
}

export interface PiSessionState {
	model?: PiModel | null;
	thinkingLevel?: string;
	isStreaming?: boolean;
	isCompacting?: boolean;
	steeringMode?: string;
	followUpMode?: string;
	sessionFile?: string;
	sessionId?: string;
	sessionName?: string;
	autoCompactionEnabled?: boolean;
	messageCount?: number;
	pendingMessageCount?: number;
}

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ThinkingBlock {
	type: "thinking";
	thinking: string;
}

export interface ToolCallBlock {
	type: "toolCall";
	id?: string;
	name: string;
	arguments?: Record<string, unknown>;
}

export interface ImageBlock {
	type: "image";
	image?: string;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock | ImageBlock;

export interface PiUserMessage {
	role: "user";
	content: string | ContentBlock[];
	timestamp?: number;
}

export interface PiAssistantMessage {
	role: "assistant";
	content: ContentBlock[];
	model?: string;
	provider?: string;
	stopReason?: string;
	timestamp?: number;
}

export interface PiToolResultMessage {
	role: "toolResult";
	toolCallId?: string;
	toolName?: string;
	content?: ContentBlock[];
	isError?: boolean;
	timestamp?: number;
}

export interface PiBashExecutionMessage {
	role: "bashExecution";
	command?: string;
	output?: string;
	exitCode?: number;
	timestamp?: number;
}

export interface PiCustomMessage {
	role: "custom";
	content: string;
	timestamp?: number;
}

export type PiMessage =
	| PiUserMessage
	| PiAssistantMessage
	| PiToolResultMessage
	| PiBashExecutionMessage
	| PiCustomMessage;

/* ------------------------------------------------------------------ */
/* Streaming deltas (assistantMessageEvent)                             */
/* ------------------------------------------------------------------ */

export interface TextStartEvent {
	type: "text_start";
	contentIndex: number;
}

export interface TextDeltaEvent {
	type: "text_delta";
	contentIndex: number;
	delta: string;
}

export interface TextEndEvent {
	type: "text_end";
	contentIndex: number;
	content: string;
}

export interface ThinkingStartEvent {
	type: "thinking_start";
	contentIndex: number;
}

export interface ThinkingDeltaEvent {
	type: "thinking_delta";
	contentIndex: number;
	delta: string;
}

export interface ThinkingEndEvent {
	type: "thinking_end";
	contentIndex: number;
	content: string;
}

export interface ToolCallStartEvent {
	type: "toolcall_start";
	contentIndex: number;
	id: string;
	toolName: string;
}

export interface ToolCallDeltaEvent {
	type: "toolcall_delta";
	contentIndex: number;
	id?: string;
	delta: string;
}

export interface ToolCallEndEvent {
	type: "toolcall_end";
	contentIndex: number;
	toolCall: ToolCallBlock;
}

export type AssistantMessageEvent =
	| TextStartEvent
	| TextDeltaEvent
	| TextEndEvent
	| ThinkingStartEvent
	| ThinkingDeltaEvent
	| ThinkingEndEvent
	| ToolCallStartEvent
	| ToolCallDeltaEvent
	| ToolCallEndEvent;

export interface PiStreamingUpdate {
	type: "message_update";
	usage?: unknown;
	assistantMessageEvent: AssistantMessageEvent;
}

export interface PiMessageStartEvent {
	type: "message_start";
	message: PiMessage;
}

export interface PiMessageEndEvent {
	type: "message_end";
	message: PiMessage;
}

export interface PiToolExecutionStartEvent {
	type: "tool_execution_start";
	toolCallId: string;
	toolName: string;
	args?: Record<string, unknown>;
}

export interface PiToolExecutionUpdateEvent {
	type: "tool_execution_update";
	toolCallId: string;
	toolName: string;
	args?: Record<string, unknown>;
	partialResult?: {
		content?: ContentBlock[];
		details?: unknown;
	};
}

export interface PiToolExecutionEndEvent {
	type: "tool_execution_end";
	toolCallId: string;
	toolName: string;
	result?: {
		content?: ContentBlock[];
		details?: unknown;
	};
	isError?: boolean;
}

export interface PiAgentEndEvent {
	type: "agent_end";
	messages?: PiMessage[];
	willRetry?: boolean;
}

export interface PiAgentSettledEvent {
	type: "agent_settled";
}

export interface PiTurnEndEvent {
	type: "turn_end";
	message?: PiAssistantMessage;
	toolResults?: unknown[];
}

export interface PiQueueUpdateEvent {
	type: "queue_update";
	steering: string[];
	followUp: string[];
}

export interface PiCompactionEvent {
	type: "compaction_start" | "compaction_end";
	reason?: string;
	result?: unknown;
	aborted?: boolean;
}

export interface PiRetryEvent {
	type: "auto_retry_start" | "auto_retry_end";
	attempt?: number;
	success?: boolean;
	errorMessage?: string;
}

export interface PiExtensionUiRequest {
	type: "extension_ui_request";
	id: string;
	method: "select" | "confirm" | "input" | "editor" | "notify" | "setStatus" | "setWidget" | "setTitle" | "set_editor_text";
	title?: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	timeout?: number;
	notifyType?: "info" | "warning" | "error";
	statusKey?: string;
	statusText?: string;
	widgetKey?: string;
	widgetLines?: string[];
	widgetPlacement?: "aboveEditor" | "belowEditor";
	text?: string;
}

export type PiEvent =
	| PiStreamingUpdate
	| PiMessageStartEvent
	| PiMessageEndEvent
	| PiToolExecutionStartEvent
	| PiToolExecutionUpdateEvent
	| PiToolExecutionEndEvent
	| PiAgentEndEvent
	| PiAgentSettledEvent
	| PiTurnEndEvent
	| PiQueueUpdateEvent
	| PiCompactionEvent
	| PiRetryEvent
	| PiExtensionUiRequest
	| { type: string; [key: string]: unknown };
